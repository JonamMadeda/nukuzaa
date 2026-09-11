import { useState } from 'react';
import {
  Check,
  Copy,
  FileText,
  FolderOpen,
  Folders,
  LayoutGrid,
  LibraryBig,
  List,
  Loader2,
  Plus,
  Search,
  Trash2,
  WifiOff,
} from 'lucide-react';
import type { Folder } from '../lib/types';
import { cn, formatDate } from '../lib/utils';

export type FolderViewMode = 'grid' | 'list';

interface Props {
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
  onOpenCreate: () => void;
  onOpenFolder: (f: Folder) => void;
  onDeleteFolder: (f: Folder) => void;
  onRetry: () => void;
}

export default function Dashboard(p: Props) {
  const totalDocs = p.folders.reduce((n, f) => n + f.docCount, 0);
  const collections = p.folders.filter((f) => f.docCount > 0).length;
  const q = p.search.trim().toLowerCase();
  const visible = q
    ? p.folders.filter((f) => f.title.toLowerCase().includes(q))
    : p.folders;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {/* Folder management header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Your folders</h1>
          <p className="mt-1 text-sm text-stone-500">
            {p.folders.length} {p.folders.length === 1 ? 'folder' : 'folders'} · {totalDocs}{' '}
            {totalDocs === 1 ? 'document' : 'documents'}
          </p>
        </div>
        <button
          onClick={p.onOpenCreate}
          className="inline-flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white shadow-card hover:bg-stone-700"
        >
          <Plus className="h-4 w-4" /> Create New Folder
        </button>
      </div>

      {/* Metric cards */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Metric icon={<Folders className="h-5 w-5" />} label="Total Folders" value={p.folders.length} />
        <Metric icon={<FileText className="h-5 w-5" />} label="Total Documents" value={totalDocs} />
        <Metric icon={<LibraryBig className="h-5 w-5" />} label="Total Collections" value={collections} hint="folders with ≥ 1 doc" />
      </div>

      {/* Search + view toggle */}
      <div className="mt-6 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <input
            value={p.search}
            onChange={(e) => p.onSearch(e.target.value)}
            placeholder="Search folders..."
            className="w-full rounded-xl border border-stone-300 bg-white py-2.5 pl-10 pr-4 text-sm outline-none placeholder:text-stone-400 focus:border-stone-900 focus:ring-2 focus:ring-stone-200"
          />
        </div>
        <div className="flex rounded-xl border border-stone-300 bg-white p-1">
          <ToggleBtn active={p.mode === 'grid'} onClick={() => p.onMode('grid')} label="Grid view">
            <LayoutGrid className="h-4 w-4" />
          </ToggleBtn>
          <ToggleBtn active={p.mode === 'list'} onClick={() => p.onMode('list')} label="List view">
            <List className="h-4 w-4" />
          </ToggleBtn>
        </div>
      </div>

      {/* Content states */}
      {p.loading ? (
        <div className={cn('mt-6', p.mode === 'grid' ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3' : 'flex flex-col gap-3')}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-stone-200 bg-white p-5">
              <div className="h-4 w-2/3 animate-pulse rounded bg-stone-200" />
              <div className="mt-3 h-3 w-1/3 animate-pulse rounded bg-stone-100" />
            </div>
          ))}
          <p className="col-span-full mt-2 inline-flex items-center gap-2 text-sm text-stone-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading folders from Neon…
          </p>
        </div>
      ) : p.dbError ? (
        <DbErrorCard
          error={p.dbError}
          dbHost={p.dbHost}
          autoRetrying={p.autoRetrying}
          attempt={p.attempt}
          onRetry={p.onRetry}
        />
      ) : visible.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-stone-300 bg-white p-12 text-center">
          <FolderOpen className="mx-auto h-10 w-10 text-stone-300" />
          <h2 className="mt-3 font-semibold">
            {p.folders.length === 0 ? 'No folders yet' : 'No folders match your search'}
          </h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
            {p.folders.length === 0
              ? 'Create your first folder, then paste any YouTube URL to save its transcript.'
              : `Nothing named "${p.search.trim()}". Try a different search.`}
          </p>
          {p.folders.length === 0 && (
            <button
              onClick={p.onOpenCreate}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
            >
              <Plus className="h-4 w-4" /> Create New Folder
            </button>
          )}
        </div>
      ) : p.mode === 'grid' ? (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((f) => (
            <FolderCard key={f.id} folder={f} onOpen={() => p.onOpenFolder(f)} onDelete={() => p.onDeleteFolder(f)} />
          ))}
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {visible.map((f) => (
            <button
              key={f.id}
              onClick={() => p.onOpenFolder(f)}
              className="group flex items-center gap-4 rounded-2xl border border-stone-200 bg-white p-4 text-left shadow-card transition hover:border-stone-300 hover:shadow"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                <FolderOpen className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{f.title}</span>
                <span className="mt-0.5 block text-xs text-stone-500">
                  {f.docCount} {f.docCount === 1 ? 'document' : 'documents'} · Created {formatDate(f.createdAt)}
                </span>
              </span>
              <span
                role="button"
                tabIndex={0}
                title="Delete folder"
                onClick={(e) => {
                  e.stopPropagation();
                  p.onDeleteFolder(f);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.stopPropagation();
                    p.onDeleteFolder(f);
                  }
                }}
                className="rounded-lg p-2 text-stone-300 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
              >
                <Trash2 className="h-4 w-4" />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-card">
      <div className="flex items-center gap-2 text-stone-500">
        {icon}
        <p className="text-sm font-medium">{label}</p>
      </div>
      <p className="mt-2 text-3xl font-bold tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-stone-400">{hint}</p>}
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'rounded-lg p-2 transition',
        active ? 'bg-stone-900 text-white' : 'text-stone-500 hover:bg-stone-100 hover:text-stone-800',
      )}
    >
      {children}
    </button>
  );
}

function FolderCard({ folder, onOpen, onDelete }: { folder: Folder; onOpen: () => void; onDelete: () => void }) {
  return (
    <div
      onClick={onOpen}
      className="group cursor-pointer rounded-2xl border border-stone-200 bg-white p-5 shadow-card transition hover:-translate-y-0.5 hover:border-stone-300 hover:shadow"
    >
      <div className="flex items-start justify-between">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
          <FolderOpen className="h-5 w-5" />
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete folder"
          className="rounded-lg p-2 text-stone-300 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <h3 className="mt-4 truncate font-semibold">{folder.title}</h3>
      <p className="mt-1 text-xs text-stone-500">
        {folder.docCount} {folder.docCount === 1 ? 'document' : 'documents'} · Created {formatDate(folder.createdAt)}
      </p>
    </div>
  );
}

function DbErrorCard({
  error,
  dbHost = null,
  autoRetrying = false,
  attempt = 0,
  onRetry,
}: {
  error: string;
  dbHost?: string | null;
  autoRetrying?: boolean;
  attempt?: number;
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copyDiagnostics = async () => {
    const text = `Nukuzaa diagnostics\nTarget DB host: ${dbHost ?? '(no URL configured)'}\nAttempt: ${attempt ?? 0}\nError: ${error}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
      <WifiOff className="mx-auto h-8 w-8 text-red-400" />
      <h2 className="mt-3 font-semibold text-red-900">Could not reach the database</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-red-700">{error}</p>
      <p className="mx-auto mt-2 max-w-md font-mono text-xs text-red-500">
        Target: {dbHost ?? '(no database URL configured — check .env)'}
      </p>
      {autoRetrying && (
        <p className="mt-2 inline-flex items-center gap-2 text-sm text-amber-700">
          <Loader2 className="h-4 w-4 animate-spin" /> Retrying automatically… (attempt {attempt ?? 0})
        </p>
      )}
      <div className="mt-4 flex items-center justify-center gap-2">
        <button
          onClick={onRetry}
          className="rounded-xl bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
        >
          Retry connection
        </button>
        <button
          onClick={copyDiagnostics}
          title="Copy error details (host + message, no secrets)"
          className="inline-flex items-center gap-1.5 rounded-xl border border-red-300 bg-white px-3.5 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copied' : 'Copy details'}
        </button>
      </div>
    </div>
  );
}
