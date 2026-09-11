export interface CaptionCue {
  /** seconds from video start */
  start: number;
  /** cue duration in seconds */
  dur: number;
  text: string;
}

export interface Folder {
  id: string;
  title: string;
  createdAt: string;
  docCount: number;
}

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
}

export type DbStatus = 'connecting' | 'ready' | 'error';

export interface ExtractionResult {
  videoId: string;
  title: string;
  thumbnail: string;
  url: string;
  rawText: string;
  captions: CaptionCue[];
}
