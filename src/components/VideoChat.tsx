import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Loader2,
  MessageCircle,
  Send,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react';
import type { TranscriptDoc } from '../lib/types';
import { docDisplayText, timestampUrl, cn } from '../lib/utils';
import { askTranscriptQuestion, type ChatTurn } from '../lib/chat';
import { getProxyUrl } from '../lib/summarize';
import { useToast } from '../hooks/useToast';

interface Props {
  doc: TranscriptDoc;
}

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  streaming?: boolean;
}

const SUGGESTIONS = [
  'Summarize this video in 3 sentences',
  'What are the key arguments or steps?',
  'What should I do next based on this?',
  'Any quotes worth saving?',
];

function newMsgId(prefix: string): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}-${crypto.randomUUID()}`;
    }
  } catch {
    /* fall through to counter fallback */
  }
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function parseTimestampToSecs(token: string): number | null {
  const parts = token.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

/** Render **bold** + [MM:SS] cites as clickable timestamp links. */
function renderAnswer(
  text: string,
  videoUrl: string,
  onOpenStamp: (url: string) => void,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const para = text.split(/\n{2,}|\n/);
  para.forEach((p, pi) => {
    const nodes: React.ReactNode[] = [];
    // Split bold first, then linkify timestamps inside each chunk.
    const boldParts = p.split(/(\*\*[^*]+\*\*)/g);
    let k = 0;
    for (const chunk of boldParts) {
      if (!chunk) continue;
      const isBold = chunk.startsWith('**') && chunk.endsWith('**') && chunk.length > 4;
      const inner = isBold ? chunk.slice(2, -2) : chunk;
      const stampParts = inner.split(/(\[\d{1,2}:\d{2}(?::\d{2})?\])/g);
      for (const sp of stampParts) {
        if (!sp) continue;
        const m = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]$/.exec(sp);
        if (m) {
          const secs = parseTimestampToSecs(m[1]);
          const url = secs != null ? timestampUrl(videoUrl, secs) : videoUrl;
          nodes.push(
            <button
              key={`${pi}-${k++}`}
              onClick={() => onOpenStamp(url)}
              title={`Jump to ${m[1]} in the video`}
              className="mx-0.5 rounded bg-sky-100 px-1 py-0.5 font-mono text-[0.8em] font-semibold text-sky-800 hover:bg-sky-200"
            >
              {m[1]}
            </button>,
          );
        } else if (isBold) {
          nodes.push(<strong key={`${pi}-${k++}`} className="font-semibold text-stone-900">{sp}</strong>);
        } else {
          nodes.push(<span key={`${pi}-${k++}`}>{sp}</span>);
        }
      }
    }
    out.push(<p key={pi} className="my-1.5 leading-7 text-stone-800">{nodes}</p>);
  });
  return out;
}

export default function VideoChat({ doc }: Props) {
  const { notify } = useToast();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [lastModel, setLastModel] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const hasText = useMemo(() => docDisplayText(doc).trim().length > 0, [doc]);
  const viaProxy = getProxyUrl() != null;

  useEffect(() => {
    setMessages([]);
    setInput('');
    setLoading(false);
    setError(null);
    setLastModel(null);
    abortRef.current?.abort();
    abortRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  // Abort any in-flight request on unmount so streaming never writes into
  // an unmounted component.
  useEffect(() => () => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  const openStamp = async (url: string) => {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const copyAnswer = async (m: Msg) => {
    try {
      await navigator.clipboard.writeText(m.content);
    } catch {
      notify('error', 'Copy failed — select the text manually.');
      return;
    }
    setCopiedId(m.id);
    window.setTimeout(() => setCopiedId((c) => (c === m.id ? null : c)), 2000);
  };

  const send = async (raw?: string) => {
    const question = (raw ?? input).trim();
    if (!question || loading || !hasText) return;
    // Abort any previous stream before starting a new one (suggestion
    // buttons can fire while a prior answer is still streaming).
    abortRef.current?.abort();
    setError(null);
    const userMsg: Msg = { id: newMsgId('u'), role: 'user', content: question };
    const history: ChatTurn[] = messages
      .filter((m) => !m.streaming && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content }));
    const assistantId = newMsgId('a');
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: 'assistant', content: '', streaming: true }]);
    setInput('');
    setLoading(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const r = await askTranscriptQuestion(doc, history, question, {
        signal: ctrl.signal,
        onToken: (partial) =>
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: partial } : m))),
      });
      setLastModel(r.model);
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: r.answer, model: r.model, streaming: false } : m)),
      );
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        // Stopped by the user — keep whatever streamed in so far.
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)));
      } else {
        const msg = e instanceof Error ? e.message : 'Could not get an answer.';
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        setError(msg);
        notify('error', msg);
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const stop = () => abortRef.current?.abort();

  if (!hasText) {
    return <p className="text-sm text-stone-500">No transcript text available to chat about yet.</p>;
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[68ch] flex-1 flex-col">
      <div className="no-print mb-3 flex shrink-0 items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2">
        <MessageCircle className="h-4 w-4 shrink-0 text-sky-700" />
        <p className="text-xs leading-5 text-sky-900">
          <strong>Grounded in this video</strong> — answers come only from this transcript, with clickable timestamps.
        </p>
        {messages.length > 0 && (
          <button
            onClick={() => { setMessages([]); setError(null); setLastModel(null); }}
            title="Clear this chat"
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-lg border border-sky-200 bg-white px-2 py-1 text-[11px] font-medium text-sky-800 hover:bg-sky-100"
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>

      {messages.length === 0 && !loading && (
        <div className="no-print mb-3 shrink-0">
          <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Try asking</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => void send(s)}
                className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 transition hover:border-sky-400 hover:bg-sky-50 hover:text-sky-900"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div ref={listRef} aria-live="polite" className="nice-scroll flex min-h-[36vh] flex-1 flex-col overflow-y-auto rounded-lg border border-stone-200 bg-stone-50/60 p-3 lg:min-h-0 print:overflow-visible">
        {messages.length === 0 && !loading && (
          <div className="m-auto flex flex-col items-center py-6 text-center">
            <Sparkles className="h-6 w-6 text-stone-300" />
            <p className="mt-2 text-sm font-medium text-stone-600">Ask anything about this video</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-stone-500">
              e.g. “What does the speaker say about X?” — the AI reads the full transcript and answers with timestamps.
            </p>
          </div>
        )}
        <div className="flex flex-col gap-2.5">
          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="ml-auto max-w-[85%] rounded-lg rounded-br-md bg-stone-950 px-3.5 py-2.5 text-sm leading-6 text-white">
                {m.content}
              </div>
            ) : (
              <div key={m.id} className="mr-auto max-w-[95%] rounded-lg rounded-bl-md border border-stone-200 bg-white px-3.5 py-2.5 text-sm shadow-sm">
                {m.content ? (
                  <div className="font-serif text-[0.98rem]">
                    {renderAnswer(m.content, doc.url, (u) => void openStamp(u))}
                    {m.streaming && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-sky-500 align-middle" aria-hidden />}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-stone-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Thinking — reading the transcript…
                  </div>
                )}
                {m.content.trim().length > 0 ? (
                  <div className="mt-1.5 flex items-center gap-2 border-t border-stone-100 pt-1.5">
                    <button
                      onClick={() => void copyAnswer(m)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-stone-400 hover:text-stone-700"
                    >
                      {copiedId === m.id ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedId === m.id ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                ) : null}
              </div>
            ),
          )}
        </div>
      </div>

      {error && (
        <div className="no-print mt-2 shrink-0 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
          {error}
        </div>
      )}

      <div className="no-print mt-2.5 flex shrink-0 items-end gap-2">
        <textarea
          ref={inputRef}
          id="reader-chat"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          placeholder={loading ? 'Answer streaming… type your next question, then Send or Stop' : 'Ask about this video… (Enter to send, Shift+Enter for newline)'}
          aria-label="Ask a question about this video"
          className="max-h-32 min-w-0 flex-1 resize-y rounded-md border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none placeholder:text-stone-400 focus:border-sky-500 disabled:bg-stone-50"
        />
        <button
          onClick={() => (loading ? stop() : void send())}
          disabled={!loading && !input.trim()}
          aria-label={loading ? 'Stop generating' : 'Send question'}
          title={loading ? 'Stop generating' : 'Send question'}
          className={cn(
            'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-white shadow-sm transition disabled:opacity-50',
            loading ? 'bg-red-600 hover:bg-red-500' : 'bg-sky-600 hover:bg-sky-500',
          )}
        >
          {loading ? <Square className="h-4 w-4 fill-current" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
      <p className="no-print mt-1.5 shrink-0 text-[11px] leading-4 text-stone-400">
        Free OpenRouter model, fastest provider first{lastModel ? <> · <code className="font-mono">{lastModel}</code></> : null}
        {viaProxy ? ' · shared key, daily per-user limits apply' : ' · uses your own API key'}
        {' '}· answers stream live and never leave this transcript.
      </p>
    </div>
  );
}
