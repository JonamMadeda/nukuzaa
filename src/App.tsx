import { useCallback, useEffect, useRef, useState } from 'react';
import Header from './components/Header';
import Dashboard, { type FolderViewMode } from './components/Dashboard';
import Workspace from './components/Workspace';
import TranscriptReaderModal from './components/TranscriptReaderModal';
import CreateFolderModal from './components/CreateFolderModal';
import UpdateManager, { CHECK_UPDATES_EVENT } from './components/UpdateManager';
import { ToastProvider, useToast } from './hooks/useToast';
import {
  checkConnection,
  createFolder,
  deleteFolder,
  getDbHost,
  listFoldersWithCounts,
} from './lib/db';
import type { DbStatus, Folder, TranscriptDoc } from './lib/types';
import { friendlyDbError } from './lib/utils';

type View = { name: 'dashboard' } | { name: 'workspace'; folder: Folder };

/** Initial try + scheduled re-tries (4s, 8s, 12s, 16s). Covers Neon cold starts. */
const MAX_ATTEMPTS = 5;

function Shell() {
  const { notify } = useToast();
  const [status, setStatus] = useState<DbStatus>('connecting');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [autoRetrying, setAutoRetrying] = useState(false);
  const [dbHost] = useState<string | null>(() => getDbHost());
  const attemptRef = useRef(0);
  const retryTimer = useRef<number | null>(null);
  const [view, setView] = useState<View>({ name: 'dashboard' });
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<FolderViewMode>('grid');
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [activeDoc, setActiveDoc] = useState<TranscriptDoc | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { getVersion } = await import('@tauri-apps/api/app');
        setAppVersion(await getVersion());
      } catch {
        /* browser preview — no native version */
      }
    })();
  }, []);

  const loadFolders = useCallback(
    async (opts?: { retry?: boolean }) => {
      const isRetry = opts?.retry ?? false;
      if (retryTimer.current) {
        window.clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
      if (!isRetry) {
        attemptRef.current = 0;
        setAttempt(0);
      }
      setAutoRetrying(false);
      setStatus('connecting');
      setLoadingFolders(true);
      setDbError(null);
      try {
        await checkConnection();
        setStatus('ready');
        setFolders(await listFoldersWithCounts());
        if (attemptRef.current > 0) notify('success', 'Back online — Neon connected.');
      } catch (e) {
        attemptRef.current += 1;
        setAttempt(attemptRef.current);
        setStatus('error');
        setDbError(friendlyDbError(e));
        setLoadingFolders(false);
        if (attemptRef.current < MAX_ATTEMPTS) {
          setAutoRetrying(true);
          retryTimer.current = window.setTimeout(
            () => void loadFolders({ retry: true }),
            attemptRef.current * 4000,
          );
        }
        return;
      }
      setLoadingFolders(false);
    },
    [notify],
  );

  useEffect(() => {
    void loadFolders();
    return () => {
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
    };
  }, [loadFolders]);

  // Keep workspace header title fresh when counts change.
  const refreshCounts = useCallback(async () => {
    try {
      const next = await listFoldersWithCounts();
      setFolders(next);
      setView((v) =>
        v.name === 'workspace'
          ? { ...v, folder: next.find((f) => f.id === v.folder.id) ?? v.folder }
          : v,
      );
    } catch {
      /* non-fatal — workspace already shows its own error state */
    }
  }, []);

  const handleCreate = async (title: string) => {
    setCreating(true);
    try {
      const f = await createFolder(title);
      setFolders((prev) => [f, ...prev]);
      setCreateOpen(false);
      notify('success', `Folder “${f.title}” created.`);
    } catch (e) {
      notify('error', friendlyDbError(e));
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteFolder = async (f: Folder) => {
    const docs = f.docCount;
    const ok = window.confirm(
      docs > 0
        ? `Delete “${f.title}” and its ${docs} saved ${docs === 1 ? 'transcript' : 'transcripts'}?`
        : `Delete folder “${f.title}”?`,
    );
    if (!ok) return;
    try {
      await deleteFolder(f.id);
      setFolders((prev) => prev.filter((x) => x.id !== f.id));
      if (view.name === 'workspace' && view.folder.id === f.id) setView({ name: 'dashboard' });
      notify('success', 'Folder deleted.');
    } catch (e) {
      notify('error', friendlyDbError(e));
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <Header status={status} onRetry={() => void loadFolders()} autoRetrying={autoRetrying} attempt={attempt} />

      <main className="flex-1">
        {view.name === 'dashboard' ? (
          <Dashboard
            folders={folders}
            loading={loadingFolders}
            dbError={dbError}
            dbHost={dbHost}
            autoRetrying={autoRetrying}
            attempt={attempt}
            search={search}
            onSearch={setSearch}
            mode={mode}
            onMode={setMode}
            onOpenCreate={() => setCreateOpen(true)}
            onOpenFolder={(f) => setView({ name: 'workspace', folder: f })}
            onDeleteFolder={handleDeleteFolder}
            onRetry={() => void loadFolders()}
          />
        ) : (
          <Workspace
            folder={view.folder}
            onBack={() => setView({ name: 'dashboard' })}
            onDocsChanged={refreshCounts}
            onOpenDoc={setActiveDoc}
          />
        )}
      </main>

      <footer className="flex items-center justify-center gap-2 border-t border-stone-200 py-4 text-center text-xs text-stone-400">
        <span>Nukuzaa{appVersion ? ` v${appVersion}` : ''} · transcripts on your device · stored in Neon</span>
        <span aria-hidden>·</span>
        <button
          onClick={() => window.dispatchEvent(new Event(CHECK_UPDATES_EVENT))}
          className="font-medium text-stone-500 underline decoration-dotted underline-offset-2 hover:text-stone-800"
        >
          Check for updates
        </button>
      </footer>

      <CreateFolderModal
        open={createOpen}
        creating={creating}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
      />
      <TranscriptReaderModal doc={activeDoc} onClose={() => setActiveDoc(null)} />
      <UpdateManager />
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}
