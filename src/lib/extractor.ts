import type { CaptionCue, ExtractionResult, TrackInfo } from './types';

// ---------------------------------------------------------------------------
// Local YouTube transcript extractor.
//
// Runs on the end-user's machine (Tauri desktop runtime):
//   1. video ID is parsed from any watch / youtu.be / Shorts / embed URL,
//   2. caption tracks are requested from three sources in order:
//      a. YouTubei `player` with the ANDROID client (primary) — its timedtext
//         URLs are session-independent and download cookie-free,
//      b. the watch-page HTML scrape — its timedtext URLs are session-bound
//         (HTTP 200 + empty body outside the session), which the shared
//         Rust HTTP client's cookie jar satisfies for this app's lifetime,
//      c. YouTubei `player` with the WEB client, using the player's current
//         signatureTimestamp from the scraped page's base.js — different
//         playability heuristics than ANDROID, so a bot-check that blocks
//         one client often lets the other through,
//   2b. YouTube intermittently answers cookie-less requests with
//      LOGIN_REQUIRED ("sign in to confirm you're not a bot" / age checks)
//      for perfectly public videos. That is treated as TRANSIENT: the next
//      source is tried and the whole chain re-runs once after a short pause
//      before any sign-in error is surfaced. Only a genuinely private video
//      stops the chain.
//   3. candidate tracks are tried in preference order until one yields cues,
//   4. the timedtext XML (classic <text> or srv3 word-level <p>) is decoded
//      into timestamped cues; title/thumbnail fall back gracefully.
//
// No third-party API keys, no proxy servers. The YouTubei key below is the
// public embedded key shipped inside YouTube's own clients.
// ---------------------------------------------------------------------------

export class TranscriptError extends Error {
  code: 'INVALID_URL' | 'NETWORK' | 'NO_CAPTIONS' | 'PRIVATE' | 'SIGN_IN' | 'RATE_LIMIT' | 'PARSE';
  constructor(code: TranscriptError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

const WATCH_URL = (id: string) => `https://www.youtube.com/watch?v=${id}&hl=en`;
const THUMB_URL = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
const YOUTUBEI_PLAYER =
  'https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8&prettyPrint=false';

/** Accept watch, youtu.be, /shorts/, /embed/, /live/, /v/ and music.youtube URLs. */
export function extractVideoId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  let url: URL;
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^m\./, '').replace(/^music\./, '');
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split(/[/?#]/)[0];
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  }
  if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    const v = url.searchParams.get('v');
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
    for (const prefix of ['/shorts/', '/embed/', '/live/', '/v/']) {
      if (url.pathname.startsWith(prefix)) {
        const id = url.pathname.slice(prefix.length).split(/[/?#]/)[0];
        if (/^[A-Za-z0-9_-]{11}$/.test(id)) return id;
      }
    }
  }
  return null;
}

function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

const RATE_LIMIT_MSG =
  'YouTube is rate-limiting requests from this network. Wait about a minute, then try again.';

/** The Rust commands surface HTTP failures as strings (`… HTTP 429.`);
 *  the browser path has the status directly. Both land here. */
function toTranscriptError(message: string): TranscriptError {
  if (/HTTP\s*429/.test(message)) return new TranscriptError('RATE_LIMIT', RATE_LIMIT_MSG);
  return new TranscriptError('NETWORK', message);
}

/** GET text locally: Rust command inside Tauri (no CORS, user IP), else fetch. */
async function fetchText(url: string): Promise<string> {
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<string>('fetch_url_text', { url });
    } catch (e) {
      throw toTranscriptError(e instanceof Error ? e.message : 'Desktop fetch failed.');
    }
  }
  const res = await fetch(url, { credentials: 'omit' });
  if (res.status === 429) throw new TranscriptError('RATE_LIMIT', RATE_LIMIT_MSG);
  if (!res.ok) throw new TranscriptError('NETWORK', `YouTube responded with HTTP ${res.status}.`);
  return res.text();
}

/** POST JSON locally: Rust command inside Tauri (no CORS, user IP), else fetch. */
async function postJson(url: string, data: unknown): Promise<string> {
  const body = JSON.stringify(data);
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<string>('post_json_text', { url, body });
    } catch (e) {
      throw toTranscriptError(e instanceof Error ? e.message : 'Desktop request failed.');
    }
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (res.status === 429) throw new TranscriptError('RATE_LIMIT', RATE_LIMIT_MSG);
  if (!res.ok) throw new TranscriptError('NETWORK', `YouTube responded with HTTP ${res.status}.`);
  return res.text();
}

interface CaptionTrack {
  baseUrl: string;
  /** YouTubei sends { runs: [{ text }] }; the scrape fallback sends a string. */
  name?: unknown;
  languageCode?: string;
  kind?: string;
}

/** Outcome of one caption source. Non-empty `tracks` ⇒ source succeeded. */
interface SourceResult {
  tracks: CaptionTrack[];
  title: string | null;
  /** Genuinely private video — every source agrees, stop the chain. */
  fatal?: { message: string };
  /** Sign-in demanded (bot/age heuristic) — transient, try the next source. */
  signIn?: string;
  /** Unplayable/unavailable for another reason — surfaced only if no source works. */
  unplayable?: string;
}

/** Human label for the language picker. */
export function trackLabel(t: Pick<CaptionTrack, 'name' | 'languageCode' | 'kind'>): string {
  const n = t.name;
  if (typeof n === 'string' && n.length > 0) return n;
  if (n && typeof n === 'object' && 'runs' in n) {
    const runs = (n as { runs?: Array<{ text?: unknown }> }).runs;
    if (Array.isArray(runs)) {
      const text = runs.map((r) => String(r?.text ?? '')).join('');
      if (text) return text;
    }
  }
  const lang = t.languageCode || 'unknown';
  return t.kind === 'asr' ? `${lang} (auto-generated)` : lang;
}

function decodePlayerString(s: string): string {
  return s.replace(/\\u([\dA-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Two YouTubei clients for the same endpoint: ANDROID first (fast,
 *  session-independent caption URLs), WEB as a second opinion — the two use
 *  different playability heuristics, so a bot-check that blocks one often
 *  lets the other through. `contentCheckOk`/`racyCheckOk` let age-restricted
 *  videos resolve without an interactive login.
 *
 *  WEB requires the player's current `signatureTimestamp` (STS), read from
 *  the page's base.js by `getSignatureTimestamp` — without it YouTube
 *  answers UNPLAYABLE, so the caller skips WEB when STS is unavailable. */
const YOUTUBEI_PAYLOAD = (videoId: string, variant: 'android' | 'web', sts?: number) =>
  variant === 'android'
    ? {
        videoId,
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '20.10.38',
            androidSdkVersion: 30,
            hl: 'en',
            gl: 'US',
          },
        },
        contentCheckOk: true,
        racyCheckOk: true,
      }
    : {
        videoId,
        context: {
          client: { clientName: 'WEB', clientVersion: '2.20251001.01.00', hl: 'en', gl: 'US' },
          thirdParty: { embedUrl: 'https://www.youtube.com/' },
        },
        playbackContext: { contentPlaybackContext: { signatureTimestamp: sts ?? 0 } },
        contentCheckOk: true,
        racyCheckOk: true,
      };

/** Primary source: YouTubei player API (session-independent caption URLs).
 *  Returns `signIn` for LOGIN_REQUIRED instead of throwing — the caller
 *  tries the other client / the watch-page scrape before giving up. */
async function fetchTracksViaYoutubei(
  videoId: string,
  variant: 'android' | 'web',
  sts?: number,
): Promise<SourceResult> {
  let raw: string;
  try {
    raw = await postJson(YOUTUBEI_PLAYER, YOUTUBEI_PAYLOAD(videoId, variant, sts));
  } catch (e) {
    if (e instanceof TranscriptError) throw e;
    throw new TranscriptError('NETWORK', 'Could not reach YouTube. Check your connection and retry.');
  }
  let j: {
    playabilityStatus?: { status?: string; reason?: string };
    videoDetails?: { title?: string };
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
  };
  try {
    j = JSON.parse(raw) as typeof j;
  } catch {
    throw new TranscriptError('PARSE', 'YouTube returned an unreadable response. Please retry.');
  }

  const title =
    typeof j.videoDetails?.title === 'string' && j.videoDetails.title.length > 0
      ? j.videoDetails.title
      : null;
  const tracks = (j.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []).filter(
    (t) => typeof t?.baseUrl === 'string' && t.baseUrl.length > 0,
  );

  const status = j.playabilityStatus?.status;
  const reason = j.playabilityStatus?.reason ?? '';
  // Captions present ⇒ usable, whatever the status says (the timedtext
  // download validates them); otherwise classify the failure.
  if (tracks.length > 0 || !status || status === 'OK') return { tracks, title };

  // Bot/age "sign in" demands for the same public video come and go per
  // request — never fatal here; other sources (and a retry) usually clear it.
  // Exception: private videos also arrive as LOGIN_REQUIRED, identified by
  // the reason text — those genuinely never resolve.
  if (status === 'LOGIN_REQUIRED' || status === 'AGE_VERIFICATION_REQUIRED') {
    if (/\bis private\b/i.test(reason)) {
      return { tracks: [], title, fatal: { message: 'This video is private and its captions cannot be read.' } };
    }
    return { tracks: [], title, signIn: reason || 'YouTube asked this request to be signed in.' };
  }
  if (status === 'PRIVATE') {
    return {
      tracks: [],
      title,
      fatal: { message: reason || 'This video is private and its captions cannot be read.' },
    };
  }
  if (status === 'UNPLAYABLE') {
    // Some bot/age checks surface as UNPLAYABLE with a sign-in reason —
    // those are just as transient as LOGIN_REQUIRED.
    if (/\bsign in\b|not a bot|confirm your age/i.test(reason)) {
      return { tracks: [], title, signIn: reason };
    }
    return { tracks: [], title, unplayable: reason || 'This video is not playable.' };
  }
  // Anything else YouTube calls a failure (ERROR for missing videos, …)
  // with a stated reason — surface it rather than a generic no-captions.
  if (reason) return { tracks: [], title, unplayable: reason };
  return { tracks, title };
}

/** Fallback source: captionTracks scraped from the watch-page HTML. */
function parseCaptionTracks(html: string): CaptionTrack[] {
  const m = html.match(/"captionTracks"\s*:\s*(\[.*?\])/s);
  if (!m) return [];
  try {
    const raw = decodePlayerString(m[1].replace(/\\"/g, '"').replace(/\\\//g, '/'));
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
    return parsed
      .filter((t) => typeof t.baseUrl === 'string')
      .map((t) => ({
        baseUrl: String(t.baseUrl),
        name: t.name,
        languageCode: typeof t.languageCode === 'string' ? t.languageCode : undefined,
        kind: typeof t.kind === 'string' ? t.kind : undefined,
      }));
  } catch {
    return [];
  }
}

/** Most useful track first: English manual > English auto > anything manual > rest. */
function orderTracks(tracks: CaptionTrack[]): CaptionTrack[] {
  const score = (t: CaptionTrack): number => {
    const lang = (t.languageCode ?? '').toLowerCase();
    const auto = t.kind === 'asr' ? 0 : 2;
    if (lang === 'en' || lang.startsWith('en-')) return 10 + auto;
    if (lang.startsWith('en')) return 8 + auto;
    return 1 + auto;
  };
  return [...tracks].sort((a, b) => score(b) - score(a));
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([\da-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}

export function parseCaptionXml(xml: string): CaptionCue[] {
  const cues: CaptionCue[] = [];
  const re = /<text[^>]*start="([\d.]+)"[^>]*dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const text = stripTags(decodeEntities(m[3].replace(/\n/g, ' '))).trim();
    if (!text) continue;
    cues.push({ start: Number(m[1]), dur: Number(m[2]), text });
  }
  // Fallback for srv3 word-level <p t="ms" d="ms"> format
  if (cues.length === 0) {
    const re2 = /<(?:p|span)[^>]*\bt="([\d.]+)"[^>]*\bd="([\d.]+)"[^>]*>([\s\S]*?)<\/(?:p|span)>/g;
    while ((m = re2.exec(xml)) !== null) {
      const text = stripTags(decodeEntities(m[3])).trim();
      if (!text) continue;
      cues.push({ start: Number(m[1]) / 1000, dur: Number(m[2]) / 1000, text });
    }
  }
  return cues;
}

function parseTitle(html: string): string | null {
  const m = html.match(/"videoDetails"\s*:\s*\{[^}]*?"title"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
  if (m) return decodePlayerString(m[1]).replace(/\\"/g, '"');
  const t = html.match(/<title>([^<]*)<\/title>/);
  if (t) return decodeEntities(t[1]).replace(/\s*-\s*YouTube\s*$/, '').trim() || null;
  return null;
}

async function fetchOEmbedTitle(videoId: string): Promise<string | null> {
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(WATCH_URL(videoId))}&format=json`;
    // fetchText, not bare fetch: inside Tauri a plain fetch hits CORS.
    const parsed = JSON.parse(await fetchText(url)) as { title?: unknown };
    return typeof parsed.title === 'string' && parsed.title ? parsed.title : null;
  } catch {
    return null;
  }
}

/** Current WEB-client signatureTimestamp, read from the player's base.js
 *  and cached per jsUrl (it rotates whenever YouTube ships a new player).
 *  `pageHtml` is the already-fetched watch page — its `jsUrl` is the only
 *  input needed. Returns null when unavailable (caller then skips WEB). */
let stsCache: { jsUrl: string; sts: number } | null = null;

async function getSignatureTimestamp(pageHtml: string): Promise<number | null> {
  const jsUrl = pageHtml.match(/"jsUrl":"([^"]+base\.js)"/)?.[1];
  if (!jsUrl) return null;
  if (stsCache && stsCache.jsUrl === jsUrl) return stsCache.sts;
  try {
    const js = await fetchText(`https://www.youtube.com${jsUrl}`);
    const m = js.match(/signatureTimestamp:(\d+)/);
    if (!m) return null;
    stsCache = { jsUrl, sts: Number(m[1]) };
    return stsCache.sts;
  } catch {
    return null;
  }
}

/** Watch-page scrape: captionTracks + title from the HTML. Private/sign-in
 *  text is judged only when no captions were found — LOGIN_REQUIRED strings
 *  appear incidentally in normal pages and must not fail the video. */
function parseWatchPage(html: string): SourceResult {
  const scrapedTitle = parseTitle(html);
  const scrapedTracks = parseCaptionTracks(html);
  if (scrapedTracks.length > 0) return { tracks: scrapedTracks, title: scrapedTitle };
  if (/THIS_VIDEO_IS_PRIVATE|this video is private/i.test(html)) {
    return {
      tracks: [],
      title: scrapedTitle,
      fatal: { message: 'This video is private and its captions cannot be read.' },
    };
  }
  if (/LOGIN_REQUIRED|login to confirm your age|Sign in to confirm/i.test(html)) {
    return { tracks: [], title: scrapedTitle, signIn: 'YouTube asked this request to be signed in.' };
  }
  return { tracks: [], title: scrapedTitle };
}

/** Full pipeline: URL → transcript ready to insert into Neon. */
export async function extractTranscriptFromUrl(input: string): Promise<ExtractionResult> {
  const videoId = extractVideoId(input);
  if (!videoId) {
    throw new TranscriptError(
      'INVALID_URL',
      'That does not look like a YouTube URL. Paste a watch, youtu.be, or Shorts link.',
    );
  }
  const { chosen, tracks, title } = await resolveCaptions(videoId);
  const url = WATCH_URL(videoId);
  const rawText = chosen.captions.map((c) => c.text).join(' ');
  const finalTitle =
    title ?? (await fetchOEmbedTitle(videoId)) ?? `YouTube video ${videoId}`;

  return {
    videoId,
    title: finalTitle,
    thumbnail: THUMB_URL(videoId),
    url,
    rawText,
    captions: chosen.captions,
    trackLang: chosen.track.languageCode ?? null,
    trackKind: chosen.track.kind ?? null,
    availableTracks: dedupeTrackInfos(tracks),
  };
}

/** Resolve a downloadable caption track from every source that can prove
 *  one works. Order: YouTubei ANDROID → watch-page scrape → YouTubei WEB
 *  (using the signatureTimestamp from the scraped page's base.js).
 *
 *  A source only counts when its caption FILES yield cues — the watch-page
 *  caption URLs are locked down server-side (HTTP 200 + empty body), so
 *  "tracks found" alone must not stop the chain. Sign-in demands, network
 *  hiccups and empty files are transient (try the next source); only a
 *  genuinely private video stops the chain. If the whole chain fails
 *  transiently it re-runs once after a short pause — YouTube's bot check
 *  is per-request, so a fresh pass usually clears it.
 *
 *  `preferLang` (language switcher): only tracks matching it are tried,
 *  and a source without that language is skipped, not an error. */
async function resolveCaptions(
  videoId: string,
  preferLang?: string,
): Promise<{ chosen: { track: CaptionTrack; captions: CaptionCue[] }; tracks: CaptionTrack[]; title: string | null }> {
  try {
    return await resolveCaptionsOnce(videoId, preferLang);
  } catch (e) {
    const transient =
      e instanceof TranscriptError &&
      (e.code === 'SIGN_IN' || e.code === 'NETWORK' || e.code === 'PARSE' || e.code === 'RATE_LIMIT');
    if (!transient) throw e;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return resolveCaptionsOnce(videoId, preferLang);
  }
}

async function resolveCaptionsOnce(
  videoId: string,
  preferLang?: string,
): Promise<{ chosen: { track: CaptionTrack; captions: CaptionCue[] }; tracks: CaptionTrack[]; title: string | null }> {
  // Plain strings/vars: TypeScript can't see assignments made inside
  // closures below, and property access on those narrows to `never`.
  let title: string | null = null;
  let fatal: string | null = null;
  let signIn: string | null = null;
  let unplayable: string | null = null;
  let transient: TranscriptError | null = null;
  let sawEmptyCaptions = false;
  let rateLimited = false;

  /** Fold a source result into the chain state; returns downloadable tracks. */
  const candidatesFor = (r: SourceResult): CaptionTrack[] => {
    if (r.title && !title) title = r.title;
    if (r.fatal) fatal = r.fatal.message;
    else if (r.signIn) signIn = r.signIn;
    else if (r.unplayable) unplayable = r.unplayable;
    if (r.tracks.length === 0) return [];
    if (!preferLang) return orderTracks(r.tracks);
    const want = preferLang.toLowerCase();
    const ordered = orderTracks(r.tracks);
    const exact = ordered.filter((t) => (t.languageCode ?? '').toLowerCase() === want);
    const partial = ordered.filter((t) => {
      const l = (t.languageCode ?? '').toLowerCase();
      return l.startsWith(want) && l !== want;
    });
    return [...exact, ...partial];
  };
  /** Run one source (tracks + download); null ⇒ keep the chain going. */
  const trySource = async (
    r: SourceResult,
  ): Promise<{ chosen: { track: CaptionTrack; captions: CaptionCue[] }; tracks: CaptionTrack[] } | null> => {
    const candidates = candidatesFor(r);
    if (r.tracks.length > 0 && candidates.length === 0) return null; // other language only
    if (candidates.length === 0) return null;
    try {
      const chosen = await downloadFirstUsableTrack(candidates);
      return { chosen, tracks: r.tracks };
    } catch (e) {
      if (e instanceof TranscriptError && e.code === 'NO_CAPTIONS') {
        sawEmptyCaptions = true; // locked-down / dead caption URLs
        return null;
      }
      if (e instanceof TranscriptError && e.code === 'NETWORK') {
        transient = e;
        return null;
      }
      throw e;
    }
  };
  const note = (e: unknown): void => {
    if (e instanceof TranscriptError && e.code === 'INVALID_URL') throw e;
    // Rate limit ⇒ stop the whole chain: every later source would hit the
    // same per-IP quota and only make the block worse.
    if (e instanceof TranscriptError && e.code === 'RATE_LIMIT') {
      rateLimited = true;
      return;
    }
    transient =
      e instanceof TranscriptError
        ? e
        : new TranscriptError('NETWORK', 'Could not reach YouTube. Check your connection and retry.');
  };

  // 1. YouTubei ANDROID — primary source (session-independent caption URLs).
  try {
    const got = await trySource(await fetchTracksViaYoutubei(videoId, 'android'));
    if (got) return { ...got, title };
  } catch (e) {
    note(e);
  }

  // 2. Watch-page scrape — its HTML also carries the jsUrl that step 3 needs
  //    (its caption URLs themselves usually download empty; step 3 covers it).
  let pageHtml: string | null = null;
  if (!fatal && !rateLimited) {
    try {
      pageHtml = await fetchText(WATCH_URL(videoId));
      const got = await trySource(parseWatchPage(pageHtml));
      if (got) return { ...got, title };
    } catch (e) {
      note(e);
    }
  }

  // 3. YouTubei WEB — different playability heuristics than ANDROID; needs
  //    the player's current signatureTimestamp from the scraped page.
  if (!fatal && !rateLimited && pageHtml) {
    try {
      const sts = await getSignatureTimestamp(pageHtml);
      if (sts != null) {
        const got = await trySource(await fetchTracksViaYoutubei(videoId, 'web', sts));
        if (got) return { ...got, title };
      }
    } catch (e) {
      note(e);
    }
  }

  if (fatal) throw new TranscriptError('PRIVATE', fatal);
  // Rate limit outranks everything except a confirmed-private video — it's
  // the one failure with a concrete, actionable instruction (wait a minute).
  if (rateLimited) throw new TranscriptError('RATE_LIMIT', RATE_LIMIT_MSG);
  // A sign-in demand that survived the full chain + a delay gets an honest
  // message: it's a temporary bot check, not a private video.
  if (signIn) {
    throw new TranscriptError(
      'SIGN_IN',
      `YouTube asked this request to sign in: ${signIn} — it's usually a temporary bot check, not a private video. Retry in a few seconds.`,
    );
  }
  if (unplayable) throw new TranscriptError('PRIVATE', `Unavailable: ${unplayable}`);
  if (transient) throw transient;
  if (sawEmptyCaptions) {
    throw new TranscriptError(
      'NO_CAPTIONS',
      'Caption files were empty or in an unknown format. Try again later — auto-captions can take time to appear.',
    );
  }
  if (preferLang) throw new TranscriptError('NO_CAPTIONS', `No ${preferLang} captions found for this video.`);
  throw new TranscriptError(
    'NO_CAPTIONS',
    'No captions found for this video. The uploader may have disabled them, or auto-captions are still processing for a very recent upload.',
  );
}

/** Try candidate tracks (in the order given) — empty files are skipped. */
async function downloadFirstUsableTrack(
  candidates: CaptionTrack[],
): Promise<{ track: CaptionTrack; captions: CaptionCue[] }> {
  let networkError: TranscriptError | null = null;
  let fetchedAny = false;
  for (const track of candidates) {
    let xml: string;
    try {
      xml = await fetchText(track.baseUrl);
    } catch (e) {
      // One dead track must not abandon the others — remember and continue.
      if (e instanceof TranscriptError && e.code === 'NETWORK') {
        networkError = e;
        continue;
      }
      throw e;
    }
    fetchedAny = true;
    if (!xml || xml.trim().length === 0) continue; // expired/session-bound URL
    const captions = parseCaptionXml(xml);
    if (captions.length > 0) return { track, captions };
  }
  // Nothing parsed. Every fetch failing outright is a retryable network
  // error; files that fetched but came back empty are YouTube's locked-down
  // caption URLs — the chain moves to the next source either way.
  if (networkError && !fetchedAny) throw networkError;
  throw new TranscriptError(
    'NO_CAPTIONS',
    'Caption files were empty or in an unknown format. Try again later — auto-captions can take time to appear.',
  );
}

function dedupeTrackInfos(tracks: CaptionTrack[]): TrackInfo[] {
  const seen = new Set<string>();
  const out: TrackInfo[] = [];
  for (const t of tracks) {
    const key = `${t.languageCode ?? ''}|${t.kind ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      languageCode: t.languageCode ?? '',
      label: trackLabel(t),
      kind: t.kind ?? '',
    });
  }
  return out;
}

/** Languages a video offers (for the picker). Throws the usual TranscriptError.
 *  Resolves captions (not just track metadata) so only languages that
 *  actually download are offered. */
export async function listAvailableTracks(input: string): Promise<{ videoId: string; tracks: TrackInfo[] }> {
  const videoId = extractVideoId(input);
  if (!videoId) throw new TranscriptError('INVALID_URL', 'That does not look like a YouTube URL.');
  const { tracks } = await resolveCaptions(videoId);
  return { videoId, tracks: dedupeTrackInfos(tracks) };
}

/** Re-extract in a specific language (fresh track URLs — never stored). */
export async function extractTrackFromUrl(input: string, languageCode: string): Promise<ExtractionResult> {
  const videoId = extractVideoId(input);
  if (!videoId) throw new TranscriptError('INVALID_URL', 'That does not look like a YouTube URL.');
  const { chosen, tracks, title } = await resolveCaptions(videoId, languageCode);
  const captions = chosen.captions;
  const url = WATCH_URL(videoId);
  return {
    videoId,
    title: title ?? (await fetchOEmbedTitle(videoId)) ?? `YouTube video ${videoId}`,
    thumbnail: THUMB_URL(videoId),
    url,
    rawText: captions.map((c) => c.text).join(' '),
    captions,
    trackLang: chosen.track.languageCode ?? null,
    trackKind: chosen.track.kind ?? null,
    availableTracks: dedupeTrackInfos(tracks),
  };
}

/** Extract video IDs from a playlist URL (up to 50, in playlist order). */
export async function extractPlaylistIds(input: string): Promise<{ playlistId: string; videoIds: string[] }> {
  const raw = input.trim();
  let listId: string | null = null;
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    listId = u.searchParams.get('list');
  } catch {
    listId = null;
  }
  if (!listId) throw new TranscriptError('INVALID_URL', 'That URL has no playlist (?list=…).');
  const html = await fetchText(`https://www.youtube.com/playlist?list=${encodeURIComponent(listId)}`);
  const ids: string[] = [];
  const seen = new Set<string>();
  const re = /"videoId":"([A-Za-z0-9_-]{11})"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && ids.length < 50) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      ids.push(m[1]);
    }
  }
  if (ids.length === 0) {
    throw new TranscriptError('NO_CAPTIONS', 'No videos found in that playlist (it may be private).');
  }
  return { playlistId: listId, videoIds: ids };
}
