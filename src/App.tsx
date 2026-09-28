import { useCallback, useEffect, useRef, useState } from 'react';
import Header from './components/Header';
import Dashboard, { type FolderViewMode } from './components/Dashboard';
import Workspace from './components/Workspace';
import TranscriptReaderModal from './components/TranscriptReaderModal';
import CreateFolderModal from './components/CreateFolderModal';
import AccountPage from './components/AccountPage';
import ShortcutsModal from './components/ShortcutsModal';
import UpdateManager, { CHECK_UPDATES_EVENT } from './components/UpdateManager';
import { ToastProvider, useToast } from './hooks/useToast';
import { authClient, SESSION_EXPIRED_EVENT, clearTokenCache, setCurrentUser } from './lib/auth';
import {
  checkConnection,
  createFolder,
  deleteFolder,
  getDbHost,
  listFoldersWithCounts,
  resetDbClient,
  updateFolder,
} from './lib/db';
import type { DbStatus, Folder, FolderAccent, FolderSort, TranscriptDoc } from './lib/types';
import { friendlyDbError } from './lib/utils';

type View = { name: 'dashboard' } | { name: 'workspace'; folder: Folder } | { name: 'account' };

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
  const [mode, setMode] = useState<FolderViewMode>('list');
  const [folderSort, setFolderSort] = useState<FolderSort>('recent');
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null);
  const [activeDoc, setActiveDoc] = useState<TranscriptDoc | null>(null);
  const [wsRefresh, setWsRefresh] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const { data: session, isPending: sessionPending, refetch: refetchSession } = authClient.useSession();
  const userId = session?.user?.id ?? null;
  const userEmail = session?.user?.email ?? null;

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
        setFolders(await listFoldersWithCounts(folderSort));
        if (attemptRef.current > 0) notify('success', 'Back online.');
      } catch (e) {
        attemptRef.current += 1;
        setAttempt(attemptRef.current);
        setStatus('error');
        setDbError(friendlyDbError(e));
        setLoadingFolders(false);
        // Auth failures (signed out / expired session) never heal by retrying.
        if (/not signed in|session expired|sign in again/i.test(e instanceof Error ? e.message : String(e))) {
          return;
        }
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
    [notify, folderSort],
  );

  // Mirror the server-validated session into the query layer. Folders load
  // only once a user is known; sign-out (or session loss) drops all cached
  // user state so the next account starts clean.
  useEffect(() => {
    if (sessionPending) return;
    setCurrentUser(userId);
    if (!userId) {
      clearTokenCache();
      resetDbClient();
      setFolders([]);
      setLoadingFolders(false);
      setStatus('connecting');
      setDbError(null);
      setView({ name: 'dashboard' });
      return;
    }
    void loadFolders();
    return () => {
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionPending, userId]);

  // If the session dies mid-use (expired cookie/revoked session), the next
  // query failure fires SESSION_EXPIRED_EVENT: drop user state, re-check the
  // session with the server, and land back on the AuthScreen.
  useEffect(() => {
    const onExpired = () => {
      setCurrentUser(null);
      clearTokenCache();
      resetDbClient();
      setFolders([]);
      setView({ name: 'dashboard' });
      setActiveDoc(null);
      setCreateOpen(false);
      notify('info', 'Session expired — please sign in again.');
      try {
        void refetchSession?.();
      } catch {
        /* refetch failure just leaves the stale hook value; next query re-fires */
      }
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [notify, refetchSession]);

  // Keep workspace header title fresh when counts change.
  const refreshCounts = useCallback(async () => {
    try {
      const next = await listFoldersWithCounts(folderSort);
      setFolders(next);
      setView((v) =>
        v.name === 'workspace'
          ? { ...v, folder: next.find((f) => f.id === v.folder.id) ?? v.folder }
          : v,
      );
    } catch {
      /* non-fatal — workspace already shows its own error state */
    }
  }, [folderSort]);

  // Keyboard shortcuts: / focus search, n new folder, ? cheatsheet, Esc back out.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (e.key === 'Escape') {
        if (shortcutsOpen) setShortcutsOpen(false);
        else if (activeDoc) {
          setActiveDoc(null);
          setWsRefresh((n) => n + 1);
        } else if (createOpen || editingFolder != null) {
          setCreateOpen(false);
          setEditingFolder(null);
        } else if (view.name !== 'dashboard') setView({ name: 'dashboard' });
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey || !userId) return;
      if (e.key === '/') {
        e.preventDefault();
        document.getElementById(view.name === 'workspace' ? 'workspace-url' : 'dashboard-search')?.focus();
      } else if (e.key === 'n' && view.name === 'dashboard') {
        setCreateOpen(true);
      } else if (e.key === '?') {
        setShortcutsOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeDoc, createOpen, editingFolder, shortcutsOpen, view.name, userId]);

  const handleCreate = async (title: string, accent: FolderAccent) => {
    setCreating(true);
    try {
      const f = await createFolder(title, accent);
      setFolders((prev) => [f, ...prev]);
      setCreateOpen(false);
      notify('success', `Folder “${f.title}” created.`);
    } catch (e) {
      notify('error', friendlyDbError(e));
    } finally {
      setCreating(false);
    }
  };

  const handleSaveFolderEdit = async (id: string, title: string, accent: FolderAccent) => {
    setCreating(true);
    try {
      await updateFolder(id, { title, accent });
      setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, title: title.trim(), accent } : f)));
      setEditingFolder(null);
      notify('success', 'Folder updated.');
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

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await authClient.signOut();
    } catch (e) {
      notify('error', friendlyDbError(e));
    } finally {
      // The session effect clears user state; do it eagerly too in case the
      // sign-out request itself failed (local session is dropped regardless).
      // Reconcile with the server so a failed request can't leave a stale
      // session rendering the app for a signed-out user.
      setCurrentUser(null);
      clearTokenCache();
      resetDbClient();
      setFolders([]);
      setView({ name: 'dashboard' });
      try {
        await refetchSession?.();
      } catch {
        /* offline — local state is already cleared above */
      }
      setSigningOut(false);
    }
  };

  if (sessionPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-100">
        <p className="text-sm text-stone-500">Checking your session…</p>
      </div>
    );
  }

  if (!userId) {
    return <AccountPage userId={null} userEmail={null} signingOut={false} onSignOut={() => {}} />;
  }

  return (
    <div className="flex min-h-full flex-col">
      <Header
        status={status}
        onRetry={() => void loadFolders()}
        autoRetrying={autoRetrying}
        onOpenAccount={() => setView({ name: 'account' })}
      />

      <main className="flex-1">
        {view.name === 'account' ? (
          <AccountPage
            userId={userId}
            userEmail={userEmail}
            signingOut={signingOut}
            onSignOut={() => void handleSignOut()}
            onBack={() => setView({ name: 'dashboard' })}
          />
        ) : view.name === 'dashboard' ? (
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
            folderSort={folderSort}
            onFolderSort={setFolderSort}
            onOpenCreate={() => setCreateOpen(true)}
            onOpenFolder={(f) => setView({ name: 'workspace', folder: f })}
            onOpenDoc={setActiveDoc}
            onEditFolder={setEditingFolder}
            onDeleteFolder={handleDeleteFolder}
            onRetry={() => void loadFolders()}
            onFoldersChanged={() => void loadFolders()}
          />
        ) : (
          <Workspace
            folder={view.folder}
            allFolders={folders}
            onBack={() => setView({ name: 'dashboard' })}
            onDocsChanged={refreshCounts}
            onOpenDoc={setActiveDoc}
            refreshKey={wsRefresh}
          />
        )}
      </main>

      <footer className="mt-auto flex items-center justify-center gap-2 border-t border-stone-200 py-2.5 text-center text-xs text-stone-400">
        <span>Nukuzaa{appVersion ? ` v${appVersion}` : ''} · transcripts on your device · private to your account</span>
        <span aria-hidden>·</span>
        <button
          onClick={() => window.dispatchEvent(new Event(CHECK_UPDATES_EVENT))}
          className="font-medium text-stone-500 underline decoration-dotted underline-offset-2 hover:text-stone-800"
        >
          Check for updates
        </button>
        <span aria-hidden>·</span>
        <button
          onClick={() => setShortcutsOpen(true)}
          title="Keyboard shortcuts (?)"
          className="font-medium text-stone-500 underline decoration-dotted underline-offset-2 hover:text-stone-800"
        >
          Shortcuts
        </button>
      </footer>

      <CreateFolderModal
        open={createOpen || editingFolder != null}
        creating={creating}
        editing={
          editingFolder ? { id: editingFolder.id, title: editingFolder.title, accent: editingFolder.accent } : null
        }
        onClose={() => {
          setCreateOpen(false);
          setEditingFolder(null);
        }}
        onCreate={handleCreate}
        onSaveEdit={handleSaveFolderEdit}
      />
      <TranscriptReaderModal
        doc={activeDoc}
        onClose={() => {
          setActiveDoc(null);
          setWsRefresh((n) => n + 1);
        }}
        onDocUpdated={setActiveDoc}
      />
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
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
