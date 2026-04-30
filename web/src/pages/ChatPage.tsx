import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, MessageCircle, Trash2, Send, StopCircle, Sparkles, Wrench, User, Bot,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/useSession';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface Conversation { id: string; title: string; updated_at: string; created_at: string; }
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  tool_name?: string | null;
  tool_input?: Record<string, unknown> | null;
  tool_output?: unknown;
  created_at: string;
}

function functionsBaseUrl(): string {
  const url = import.meta.env.VITE_SUPABASE_URL as string;
  return `${url.replace(/\/$/, '')}/functions/v1`;
}

async function callChatJSON(body: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch(`${functionsBaseUrl()}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export function ChatPage() {
  const { session } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);

  const convosQ = useQuery<Conversation[]>({
    queryKey: ['chat', 'conversations', userId],
    enabled: !!userId,
    queryFn: async () => (await callChatJSON({ action: 'list' })).conversations ?? [],
  });

  // Pick first conversation by default
  useEffect(() => {
    if (!activeId && convosQ.data && convosQ.data.length > 0) setActiveId(convosQ.data[0].id);
  }, [convosQ.data, activeId]);

  const newChat = () => setActiveId(null);

  const deleteChat = async (id: string) => {
    await callChatJSON({ action: 'delete', conversation_id: id });
    if (activeId === id) setActiveId(null);
    qc.invalidateQueries({ queryKey: ['chat', 'conversations', userId] });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 h-[calc(100vh-9rem)]">
      {/* Sidebar */}
      <aside className="hidden md:flex flex-col rounded-xl border bg-card overflow-hidden">
        <div className="p-3 border-b">
          <Button className="w-full" onClick={newChat}><Plus className="h-4 w-4" /> New chat</Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {(convosQ.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">No conversations yet</p>
          ) : (convosQ.data ?? []).map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              className={cn(
                'group w-full flex items-center gap-2 p-2 rounded-lg text-left text-sm transition-colors',
                activeId === c.id ? 'bg-accent' : 'hover:bg-accent/60',
              )}
            >
              <MessageCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate flex-1">{c.title}</span>
              <button
                onClick={(e) => { e.stopPropagation(); deleteChat(c.id); }}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-500"
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </button>
          ))}
        </div>
      </aside>

      {/* Chat pane */}
      <ChatPane
        key={activeId ?? 'new'}
        conversationId={activeId}
        onConversationCreated={(id) => {
          setActiveId(id);
          qc.invalidateQueries({ queryKey: ['chat', 'conversations', userId] });
        }}
        onAfterTurn={() => qc.invalidateQueries({ queryKey: ['chat', 'conversations', userId] })}
      />
    </div>
  );
}

interface PaneProps {
  conversationId: string | null;
  onConversationCreated: (id: string) => void;
  onAfterTurn: () => void;
}

interface PendingMsg { role: 'user' | 'assistant'; content: string; toolStatus?: string }

function ChatPane({ conversationId, onConversationCreated, onAfterTurn }: PaneProps) {
  const { session } = useSession();
  const [pending, setPending] = useState<PendingMsg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const histQ = useQuery<ChatMessage[]>({
    queryKey: ['chat', 'messages', conversationId],
    enabled: !!conversationId,
    queryFn: async () => (await callChatJSON({ action: 'history', conversation_id: conversationId })).messages ?? [],
  });

  const persisted = useMemo(() => (histQ.data ?? []).filter((m) => m.role !== 'tool' && m.role !== 'system'), [histQ.data]);

  // auto-scroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [persisted.length, pending]);

  const send = async () => {
    const message = input.trim();
    if (!message || streaming) return;
    setInput('');
    setPending([{ role: 'user', content: message }, { role: 'assistant', content: '' }]);
    setStreaming(true);
    setToolStatus(null);

    const ctl = new AbortController();
    abortRef.current = ctl;

    try {
      const { data: { session: s } } = await supabase.auth.getSession();
      const r = await fetch(`${functionsBaseUrl()}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${s?.access_token ?? ''}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
        },
        body: JSON.stringify({ message, conversation_id: conversationId ?? undefined }),
        signal: ctl.signal,
      });
      if (!r.ok || !r.body) throw new Error(await r.text());

      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let createdId: string | null = null;
      let assistant = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 2);
          if (!block.startsWith('data:')) continue;
          const payload = block.slice(5).trim();
          if (!payload) continue;
          let evt: any;
          try { evt = JSON.parse(payload); } catch { continue; }
          if (evt.conversation_id && !conversationId && !createdId) {
            createdId = evt.conversation_id;
            onConversationCreated(createdId!);
          }
          if (evt.tool_call) {
            setToolStatus(`Looking up ${prettyTool(evt.tool_call.name)}…`);
          } else if (evt.tool_result) {
            setToolStatus(null);
          } else if (evt.delta) {
            assistant += evt.delta;
            setPending([{ role: 'user', content: message }, { role: 'assistant', content: assistant }]);
          } else if (evt.error) {
            toast.error(evt.error);
          } else if (evt.done) {
            // refresh persisted history
            onAfterTurn();
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast.error((e as Error).message);
    } finally {
      setStreaming(false);
      setToolStatus(null);
      abortRef.current = null;
      setPending([]);
    }
  };

  const stop = () => abortRef.current?.abort();

  const isEmpty = persisted.length === 0 && pending.length === 0;

  return (
    <section className="flex flex-col rounded-xl border bg-card overflow-hidden">
      <header className="px-4 py-3 border-b flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="font-semibold">Plynth Assistant</h2>
        <span className="ml-auto text-xs text-muted-foreground hidden sm:block">Powered by your local Ollama · unlimited &amp; free</span>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {isEmpty && <Welcome onPick={(s) => setInput(s)} />}
        {persisted.map((m) => <Bubble key={m.id} role={m.role as 'user' | 'assistant'} content={m.content} />)}
        <AnimatePresence>
          {pending.map((m, i) => (
            <motion.div key={`p-${i}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
              <Bubble role={m.role} content={m.content} />
            </motion.div>
          ))}
          {toolStatus && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex items-center gap-2 text-xs text-muted-foreground pl-10">
              <Wrench className="h-3 w-3 animate-pulse" /> {toolStatus}
            </motion.div>
          )}
          {streaming && pending[1] && pending[1].content === '' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 text-xs text-muted-foreground pl-10">
              <span className="inline-flex gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce" />
              </span>
              Thinking…
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <footer className="border-t p-3">
        <form
          onSubmit={(e) => { e.preventDefault(); send(); }}
          className="flex items-end gap-2"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder="Ask about your EMIs, learning topics, tasks, or anything…"
            rows={1}
            disabled={!session}
            className="flex-1 resize-none max-h-40 min-h-[40px] rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {streaming ? (
            <Button type="button" variant="outline" onClick={stop} title="Stop">
              <StopCircle className="h-4 w-4" /> Stop
            </Button>
          ) : (
            <Button type="submit" disabled={!input.trim()}>
              <Send className="h-4 w-4" /> Send
            </Button>
          )}
        </form>
        <p className="text-[10px] text-muted-foreground mt-1.5 text-center">Local AI · Read-only access to your data · Press Enter to send, Shift+Enter for newline</p>
      </footer>
    </section>
  );
}

function Bubble({ role, content }: { role: 'user' | 'assistant'; content: string }) {
  const isUser = role === 'user';
  return (
    <div className={cn('flex gap-3', isUser && 'flex-row-reverse')}>
      <div className={cn(
        'h-7 w-7 rounded-full grid place-items-center shrink-0 text-xs',
        isUser ? 'bg-primary text-primary-foreground' : 'bg-accent text-foreground',
      )}>
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div className={cn(
        'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm',
        isUser ? 'bg-primary text-primary-foreground rounded-tr-sm' : 'bg-muted rounded-tl-sm',
      )}>
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{content}</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-pre:my-2 prose-pre:bg-background/60 prose-code:before:hidden prose-code:after:hidden">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content || '\u200B'}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

function Welcome({ onPick }: { onPick: (s: string) => void }) {
  const samples = [
    "What's my EMI total this month?",
    "Show overdue tasks.",
    "Which C++ topics am I learning?",
    "How is my budget looking?",
  ];
  return (
    <div className="text-center py-12 px-4">
      <div className="inline-flex h-12 w-12 rounded-full bg-primary/10 text-primary items-center justify-center mb-3">
        <Sparkles className="h-6 w-6" />
      </div>
      <h3 className="text-lg font-semibold mb-1">Ask me anything about your Plynth</h3>
      <p className="text-sm text-muted-foreground mb-6">I can pull data from your finances, learning, tasks, and jobs — or answer general questions.</p>
      <div className="grid sm:grid-cols-2 gap-2 max-w-xl mx-auto">
        {samples.map((s) => (
          <button key={s} onClick={() => onPick(s)}
            className="text-left text-sm p-3 rounded-xl border hover:bg-accent transition-colors">
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function prettyTool(name: string): string {
  const map: Record<string, string> = {
    get_finance_summary: 'your finances',
    list_loans: 'your loans',
    list_learning_topics: 'your learning topics',
    list_learning_plan_items: 'your learning plan',
    list_tasks: 'your tasks',
    list_jobs: 'your jobs',
    get_profile: 'your profile',
  };
  return map[name] ?? name;
}
