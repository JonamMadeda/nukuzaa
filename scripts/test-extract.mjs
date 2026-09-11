// End-to-end test of the REAL app extractor (bundled from src/lib/extractor.ts).
import * as extractor from './extractor.bundle.mjs';

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const origFetch = globalThis.fetch;
globalThis.fetch = (url, opts = {}) =>
  origFetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), 'User-Agent': CHROME_UA, 'Accept-Language': 'en-US,en;q=0.9' },
  });

const url = process.argv[2] || 'https://youtu.be/r5JpRpz7KRw?si=EKsfHwWoyQJcIj0O';
console.log('videoId parsed:', extractor.extractVideoId(url));
try {
  const t0 = Date.now();
  const res = await extractor.extractTranscriptFromUrl(url);
  console.log(`OK in ${Date.now() - t0}ms — cues: ${res.captions.length}`);
  console.log('title:', res.title);
  console.log('first cue:', JSON.stringify(res.captions[0]));
  console.log('rawText chars:', res.rawText.length);
} catch (e) {
  console.log('FAILED — code:', e.code || '(none)', '| message:', e.message);
}
