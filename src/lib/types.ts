export interface CaptionCue {
  /** seconds from video start */
  start: number;
  /** cue duration in seconds */
  dur: number;
  text: string;
}

/** A caption track the video offers (for the language picker). */
export interface TrackInfo {
  languageCode: string;
  label: string;
  kind: string;
}

export interface Folder {
  id: string;
  title: string;
  createdAt: string;
  docCount: number;
  pinned: boolean;
  archived: boolean;
  accent: FolderAccent;
  /** Docs added in the last 7 days. */
  recentCount: number;
}

/** Folder tile accents (literal classes so Tailwind picks them up). */
export const FOLDER_ACCENTS = {
  amber: 'bg-amber-100 text-amber-700',
  stone: 'bg-stone-200 text-stone-700',
  sky: 'bg-sky-100 text-sky-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  rose: 'bg-rose-100 text-rose-700',
  violet: 'bg-violet-100 text-violet-700',
} as const;

export type FolderAccent = keyof typeof FOLDER_ACCENTS;

export interface TranscriptDoc {
  id: string;
  folderId: string;
  videoId: string;
  title: string;
  thumbnail: string;
  url: string;
  rawText: string;
  captions: CaptionCue[];
  createdAt: string;
  /** Free-form user notes (Markdown-ish plain text). */
  notes: string;
  /** Lowercased tags, e.g. ["ml", "lecture"]. */
  tags: string[];
  favorite: boolean;
  /** User-edited transcript text; null means the extracted text is shown. */
  editedText: string | null;
  /** Cue start-times (seconds) the user highlighted. */
  highlights: number[];
  trackLang: string | null;
  trackKind: string | null;
  /** Denormalized folder title for search results / offline cache. */
  folderTitle?: string;
}

export type DbStatus = 'connecting' | 'ready' | 'error';

export interface ExtractionResult {
  videoId: string;
  title: string;
  thumbnail: string;
  url: string;
  rawText: string;
  captions: CaptionCue[];
  trackLang: string | null;
  trackKind: string | null;
  availableTracks: TrackInfo[];
}

export type FolderSort = 'recent' | 'title' | 'docs';
export type DocSort = 'newest' | 'oldest' | 'title' | 'favorite';

export interface StorageStats {
  folders: number;
  docs: number;
  bytes: number;
}
