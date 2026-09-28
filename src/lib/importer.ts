import { extractTranscriptFromUrl, extractVideoId } from './extractor';
import { findDuplicateVideo, saveTranscript } from './db';
import type { TranscriptDoc } from './types';

export interface ImportOutcome {
  status: 'saved' | 'skipped' | 'failed';
  title: string;
  detail?: string;
  doc?: TranscriptDoc;
}

/**
 * Shared single-video importer (single add, bulk, quick-add).
 * Never prompts: same-folder repeats are skipped, cross-folder copies note
 * where the video already lives.
 */
export async function importVideo(folderId: string, rawUrl: string): Promise<ImportOutcome> {
  const input = rawUrl.trim();
  const videoId = extractVideoId(input);
  if (!videoId) return { status: 'failed', title: input.slice(0, 60), detail: 'Not a YouTube URL.' };
  let dupes: Awaited<ReturnType<typeof findDuplicateVideo>> = [];
  try {
    dupes = await findDuplicateVideo(videoId);
  } catch {
    dupes = [];
  }
  if (dupes.some((d) => d.folderId === folderId)) {
    return { status: 'skipped', title: videoId, detail: 'Already in this folder.' };
  }
  const data = await extractTranscriptFromUrl(input);
  const saved = await saveTranscript({
    folderId,
    videoId: data.videoId,
    title: data.title,
    thumbnail: data.thumbnail,
    url: data.url,
    rawText: data.rawText,
    captions: data.captions,
    trackLang: data.trackLang,
    trackKind: data.trackKind,
  });
  const elsewhere = dupes.filter((d) => d.folderId !== folderId);
  return {
    status: 'saved',
    title: saved.title,
    detail: elsewhere.length > 0 ? `Also saved in: ${elsewhere.map((d) => d.folderTitle).join(', ')}` : undefined,
    doc: saved,
  };
}
