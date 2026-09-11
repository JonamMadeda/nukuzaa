import type { CaptionCue, ExtractionResult } from './types';

// ---------------------------------------------------------------------------
// Local YouTube transcript extractor.
//
// Runs on the end-user's machine (Tauri desktop runtime):
//   1. video ID is parsed from any watch / youtu.be / Shorts / embed URL,
//   2. caption tracks are requested from the YouTubei `player` endpoint
//      (ANDROID client) via the Rust `post_json_text` command — the returned
//      timedtext URLs are session-independent and download cookie-free,
//      unlike watch-page scrape URLs which come back HTTP 200 with an empty
//      body when fetched outside their original page-load session,
//   3. fallback: scrape captionTracks out of the watch-page HTML,
//   4. candidate tracks are tried in preference order until one yields cues,
//   5. the timedtext XML (classic <text> or srv3 word-level <p>) is decoded
//      into timestamped cues; title/thumbnail fall back gracefully.
//
// No third-party API keys, no proxy servers. The YouTubei key below is the
// public embedded key shipped inside YouTube's own clients.
// ---------------------------------------------------------------------------

export class TranscriptError extends Error {
  code: 'INVALID_URL' | 'NETWORK' | 'NO_CAPTIONS' | 'PRIVATE' | 'PARSE';
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

/** GET text locally: Rust command inside Tauri (no CORS, user IP), else fetch. */
async function fetchText(url: string): Promise<string> {
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<string>('fetch_url_text', { url });
    } catch (e) {
      throw new TranscriptError(
        'NETWORK',
        e instanceof Error ? e.message : 'Desktop fetch failed.',
      );
    }
  }
  const res = await fetch(url, { credentials: 'omit' });
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
      throw new TranscriptError(
        'NETWORK',
        e instanceof Error ? e.message : 'Desktop request failed.',
      );
    }
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) throw new TranscriptError('NETWORK', `YouTube responded with HTTP ${res.status}.`);
  return res.text();
}

interface CaptionTrack {
  baseUrl: string;
  name?: string;
  languageCode?: string;
  kind?: string;
}

function decodePlayerString(s: string): string {
  return s.replace(/\\u([\dA-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Primary source: YouTubei player API (session-independent caption URLs). */
async function fetchTracksViaYoutubei(
  videoId: string,
): Promise<{ tracks: CaptionTrack[]; title: string | null }> {
  const payload = {
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
  };
  let raw: string;
  try {
    raw = await postJson(YOUTUBEI_PLAYER, payload);
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

  const status = j.playabilityStatus?.status;
  if (status === 'LOGIN_REQUIRED' || status === 'AGE_VERIFICATION_REQUIRED') {
    throw new TranscriptError(
      'PRIVATE',
      j.playabilityStatus?.reason
        ? `Unavailable: ${j.playabilityStatus.reason}`
        : 'This video requires sign-in (age gate) and cannot be read.',
    );
  }
  if (status === 'PRIVATE' || status === 'UNPLAYABLE') {
    throw new TranscriptError(
      'PRIVATE',
      j.playabilityStatus?.reason || 'This video is private or unplayable.',
    );
  }

  const tracks = (j.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []).filter(
    (t) => typeof t?.baseUrl === 'string' && t.baseUrl.length > 0,
  );
  const title =
    typeof j.videoDetails?.title === 'string' && j.videoDetails.title.length > 0
      ? j.videoDetails.title
      : null;
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
        name: typeof t.name === 'object' && t.name !== null ? undefined : String(t.name ?? ''),
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
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = (await res.json()) as { title?: string };
    return j.title ?? null;
  } catch {
    return null;
  }
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
  const url = WATCH_URL(videoId);

  // 1) Caption tracks: YouTubei first, watch-page scrape as fallback.
  let tracks: CaptionTrack[] = [];
  let title: string | null = null;
  let youtubeiOk = false;
  try {
    const r = await fetchTracksViaYoutubei(videoId);
    tracks = r.tracks;
    title = r.title;
    youtubeiOk = true;
  } catch (e) {
    if (e instanceof TranscriptError && (e.code === 'PRIVATE' || e.code === 'INVALID_URL')) throw e;
    // NETWORK/PARSE → fall through to the scrape fallback below.
  }

  if (!youtubeiOk) {
    let html: string;
    try {
      html = await fetchText(url);
    } catch (e) {
      if (e instanceof TranscriptError) throw e;
      throw new TranscriptError('NETWORK', 'Could not reach YouTube. Check your connection and retry.');
    }
    if (/THIS_VIDEO_IS_PRIVATE|this video is private/i.test(html))
      throw new TranscriptError('PRIVATE', 'This video is private and its captions cannot be read.');
    if (/LOGIN_REQUIRED|login to confirm your age/i.test(html))
      throw new TranscriptError('PRIVATE', 'This video requires sign-in (age gate) and cannot be read.');
    tracks = parseCaptionTracks(html);
    title = parseTitle(html);
  }

  if (tracks.length === 0) {
    throw new TranscriptError(
      'NO_CAPTIONS',
      'No captions found for this video. The uploader may have disabled them, or auto-captions are still processing for a very recent upload.',
    );
  }

  // 2) Try candidate tracks in order — a session-bound or empty file is
  // skipped in favour of the next track instead of failing outright.
  let captions: CaptionCue[] = [];
  let networkFailed = false;
  for (const track of orderTracks(tracks)) {
    let xml: string;
    try {
      xml = await fetchText(track.baseUrl);
    } catch (e) {
      if (e instanceof TranscriptError) throw e;
      networkFailed = true;
      continue;
    }
    if (!xml || xml.trim().length === 0) continue; // expired/session-bound URL
    captions = parseCaptionXml(xml);
    if (captions.length > 0) break;
  }
  if (captions.length === 0) {
    if (networkFailed && tracks.length > 0) {
      throw new TranscriptError('NETWORK', 'Caption download failed. Please retry.');
    }
    throw new TranscriptError(
      'NO_CAPTIONS',
      'Caption files were empty or in an unknown format. Try again later — auto-captions can take time to appear.',
    );
  }

  const rawText = captions.map((c) => c.text).join(' ');
  const finalTitle =
    title ?? (await fetchOEmbedTitle(videoId)) ?? `YouTube video ${videoId}`;

  return { videoId, title: finalTitle, thumbnail: THUMB_URL(videoId), url, rawText, captions };
}
