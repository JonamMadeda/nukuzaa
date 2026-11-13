import type { Folder, FolderSort, TranscriptDoc } from '../../lib/types';

export type FolderViewMode = 'grid' | 'list';

export interface CardActions {
  folder: Folder;
  onPin: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

export interface CardProps extends CardActions {
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
}

export interface DashboardProps {
  userId: string;
  recentDocIds: string[];
  docRevision: number;
  folders: Folder[];
  loading: boolean;
  dbError: string | null;
  dbHost: string | null;
  autoRetrying: boolean;
  attempt: number;
  search: string;
  onSearch: (v: string) => void;
  mode: FolderViewMode;
  onMode: (m: FolderViewMode) => void;
  folderSort: FolderSort;
  onFolderSort: (s: FolderSort) => void;
  onOpenCreate: () => void;
  onOpenFolder: (f: Folder) => void;
  onOpenDoc: (d: TranscriptDoc) => void;
  onEditFolder: (f: Folder) => void;
  onDeleteFolder: (f: Folder) => void;
  onRetry: () => void;
  onFoldersChanged: () => void;
}
