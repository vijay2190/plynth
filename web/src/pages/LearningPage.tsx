import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Sparkles, CheckCircle2, SkipForward, CalendarClock, Flame, ExternalLink, Trash2,
  Wand2, Pencil, Undo2, ChevronLeft, ChevronRight, Calendar as CalendarIcon, Flag,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/Dialog';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/Popover';
import { Calendar } from '@/components/ui/Calendar';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Loader';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/useSession';
import { ai } from '@/lib/ai-provider';
import { cn } from '@/lib/utils';

type Topic = {
  id: string;
  topic_name: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  priority: number;
  status: 'active' | 'paused' | 'completed';
  target_completion_date: string | null;
};

type ResLink = { label: string; url: string };

type PlanRow = {
  id: string;
  topic_id: string;
  date: string;
  title: string;
  description: string | null;
  estimated_minutes: number;
  resource_links: ResLink[];
  order_in_day: number;
  status: 'pending' | 'completed' | 'skipped' | 'deferred';
  source: 'ai' | 'manual';
  ai_generated: boolean;
  learning_topics?: { topic_name: string; priority?: number; target_completion_date?: string | null };
};

const todayStr = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
// UTC-safe day arithmetic so timezone offsets don't swallow the increment.
const shiftIso = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
};

export function LearningPage() {
  const { session } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(todayStr());
  const [allocations, setAllocations] = useState<Record<string, { items: number; minutes: number }>>({});
  const [editingTopic, setEditingTopic] = useState<Topic | null>(null);
  const [editingItem, setEditingItem] = useState<PlanRow | null>(null);
  const [addingItemFor, setAddingItemFor] = useState<string | null>(null); // 'new' or null

  const topicsQ = useQuery({
    queryKey: ['topics', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('learning_topics').select('*').eq('user_id', userId!).order('priority', { ascending: false });
      return (data ?? []) as Topic[];
    },
  });

  // Overdue per topic = pending items dated strictly BEFORE today.
  const overdueQ = useQuery({
    queryKey: ['overdue', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('learning_plans')
        .select('topic_id,date')
        .eq('user_id', userId!).eq('status', 'pending').lt('date', todayStr());
      const byTopic = new Map<string, { items: number; days: Set<string> }>();
      for (const r of data ?? []) {
        const e = byTopic.get(r.topic_id) ?? { items: 0, days: new Set<string>() };
        e.items += 1;
        e.days.add(r.date as string);
        byTopic.set(r.topic_id, e);
      }
      const out: Record<string, { items: number; days: number }> = {};
      for (const [k, v] of byTopic) out[k] = { items: v.items, days: v.days.size };
      return out;
    },
    refetchInterval: 60_000,
  });

  const planQ = useQuery({
    queryKey: ['plan', userId, viewDate],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('learning_plans')
        .select('*, learning_topics(topic_name, priority, target_completion_date)')
        .eq('user_id', userId!).eq('date', viewDate).order('order_in_day');
      return (data ?? []) as PlanRow[];
    },
  });

  const streakQ = useQuery({
    queryKey: ['streak', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('learning_streaks').select('*').eq('user_id', userId!).maybeSingle();
      return data;
    },
  });

  const heatQ = useQuery({
    queryKey: ['heat', userId],
    enabled: !!userId,
    queryFn: async () => {
      const past = new Date(); past.setDate(past.getDate() - 90);
      const { data } = await supabase.from('learning_plans').select('date,status')
        .eq('user_id', userId!).gte('date', past.toISOString().slice(0, 10));
      const map: Record<string, number> = {};
      for (const r of data ?? []) {
        if (r.status === 'completed') map[r.date] = (map[r.date] || 0) + 1;
      }
      return map;
    },
  });

  const aiProviderQ = useQuery({
    queryKey: ['ai-provider'],
    queryFn: async () => {
      const { data } = await supabase.from('app_settings')
        .select('value').eq('key', 'ai_provider_chain').maybeSingle();
      const chain = (data?.value as string | undefined) || 'groq,ollama';
      const primary = chain.split(',')[0]?.trim() || 'groq';
      const labels: Record<string, string> = {
        groq: 'Groq Llama 3.3 70B',
        ollama: 'Self-hosted Ollama',
        gemini: 'Google Gemini',
      };
      return { chain, primary, label: labels[primary] || primary };
    },
    staleTime: 60_000,
  });

  // Status update for COMPLETE only (skip and defer have dedicated paths now).
  const updatePlanItemM = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: PlanRow['status'] }) => {
      const { error } = await supabase.from('learning_plans').update({
        status, completed_at: status === 'completed' ? new Date().toISOString() : null,
      }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plan', userId, viewDate] });
      qc.invalidateQueries({ queryKey: ['heat', userId] });
      qc.invalidateQueries({ queryKey: ['overdue', userId] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  // Skip = optimistic remove + 5s undo toast. After expiry: cascade-shift the next
  // future item up; if none exist, ask AI for a single replacement.
  const skippedRowsRef = (window as any).__plynthSkipped ??= new Map<string, PlanRow>();
  function skipWithUndo(p: PlanRow) {
    skippedRowsRef.set(p.id, p);
    qc.setQueryData(['plan', userId, viewDate], (cur: PlanRow[] | undefined) =>
      (cur ?? []).filter((r) => r.id !== p.id),
    );
    let undone = false;
    const t = setTimeout(async () => {
      if (undone) return;
      try {
        await supabase.from('learning_plans').update({ status: 'skipped' }).eq('id', p.id);
        const { data: shifted } = await supabase.rpc('shift_plans_up', { p_from_date: viewDate });
        if (!shifted) {
          // No future item to pull up — ask AI for a single replacement.
          try {
            await ai.generateReplacementItem(p.topic_id, viewDate);
          } catch (e) {
            console.warn('replacement failed', e);
          }
        }
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        skippedRowsRef.delete(p.id);
        qc.invalidateQueries({ queryKey: ['plan', userId, viewDate] });
        qc.invalidateQueries({ queryKey: ['overdue', userId] });
      }
    }, 5000);
    toast('Task skipped', {
      description: p.title,
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          undone = true;
          clearTimeout(t);
          skippedRowsRef.delete(p.id);
          qc.invalidateQueries({ queryKey: ['plan', userId, viewDate] });
        },
      },
    });
  }

  // Defer = move this exact row to tomorrow via RPC.
  const deferM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('defer_plan_item', { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plan', userId, viewDate] });
      qc.invalidateQueries({ queryKey: ['plan', userId, shiftIso(viewDate, 1)] });
      qc.invalidateQueries({ queryKey: ['overdue', userId] });
      toast.success('Moved to tomorrow');
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const deletePlanItemM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('learning_plans').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['plan', userId, viewDate] }); toast.success('Item removed'); },
    onError: (e) => toast.error((e as Error).message),
  });

  const regenM = useMutation({
    mutationFn: async (topicId: string) => ai.generateLearningPlan(topicId, viewDate),
    onSuccess: (items) => {
      qc.invalidateQueries({ queryKey: ['plan', userId, viewDate] });
      toast.success(`Plan regenerated (${items.length} items)`);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const dailyM = useMutation({
    mutationFn: async () => ai.generateDailyPlan(viewDate),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['plan', userId, viewDate] });
      const map: Record<string, { items: number; minutes: number }> = {};
      for (const a of res.allocations) map[a.topic_id] = { items: a.items, minutes: a.minutes };
      setAllocations(map);
      toast.success(`Plan ready: ${res.items.length} items across ${res.allocations.length} topics`);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const multiDayM = useMutation({
    mutationFn: async () => ai.generateMultiDayPlan(viewDate),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['plan', userId] });
      qc.invalidateQueries({ queryKey: ['heat', userId] });
      qc.invalidateQueries({ queryKey: ['overdue', userId] });
      toast.success(`Multi-day plan ready: ${res.total_items} items across ${res.days_planned} days (horizon ${res.horizon_days}d)`);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const deleteTopicM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('learning_topics').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['topics', userId] }); toast.success('Topic removed'); },
    onError: (e) => toast.error((e as Error).message),
  });

  const heatCells = useMemo(() => {
    const cells: { date: string; count: number }[] = [];
    for (let i = 89; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const k = d.toISOString().slice(0, 10);
      cells.push({ date: k, count: (heatQ.data ?? {})[k] ?? 0 });
    }
    return cells;
  }, [heatQ.data]);

  // Sort: high priority (priority >=4 OR target within 7 days) first, then by order_in_day.
  // Completed/skipped sink to the bottom regardless.
  const sortedPlan = useMemo(() => {
    const items = [...(planQ.data ?? [])];
    const score = (p: PlanRow) => {
      const sunk = p.status === 'completed' || p.status === 'skipped' || p.status === 'deferred' ? 1000 : 0;
      const pri = p.learning_topics?.priority ?? 3;
      const tgt = p.learning_topics?.target_completion_date;
      const daysLeft = tgt ? Math.round((new Date(tgt + 'T00:00:00Z').getTime() - new Date(viewDate + 'T00:00:00Z').getTime()) / 86400000) : 999;
      const urgent = pri >= 4 || daysLeft <= 7 ? 0 : 100;
      return sunk + urgent + (p.order_in_day ?? 0);
    };
    items.sort((a, b) => score(a) - score(b));
    return items;
  }, [planQ.data, viewDate]);

  function shiftDate(days: number) {
    setViewDate((cur) => shiftIso(cur, days));
  }

  const planTitle = viewDate === todayStr() ? "Today's Plan" : viewDate > todayStr() ? 'Upcoming Plan' : 'Past Plan';

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold">Learning Hub</h1>
          {aiProviderQ.data && (
            <Badge variant="outline" title={`Provider chain: ${aiProviderQ.data.chain}`}>
              AI: {aiProviderQ.data.label} • ready
            </Badge>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={() => multiDayM.mutate()} disabled={multiDayM.isPending} title="Plan all topics across multiple days until target completion">
            <Sparkles className="h-4 w-4" /> {multiDayM.isPending ? 'Planning…' : 'Generate plan'}
          </Button>
          <Button variant="outline" onClick={() => dailyM.mutate()} disabled={dailyM.isPending}>
            <Wand2 className="h-4 w-4" /> {dailyM.isPending ? 'Generating…' : `Generate plan for ${fmtDate(viewDate)}`}
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4" /> Add Topic</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add learning topic</DialogTitle></DialogHeader>
              <TopicForm onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: ['topics', userId] }); }} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-orange-500/15 grid place-items-center"><Flame className="h-6 w-6 text-orange-500" /></div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Current Streak</p>
              <p className="text-2xl font-bold">{streakQ.data?.current_streak ?? 0} days</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase text-muted-foreground">Longest Streak</p>
            <p className="text-2xl font-bold mt-1">{streakQ.data?.longest_streak ?? 0} days</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase text-muted-foreground">Active Topics</p>
            <p className="text-2xl font-bold mt-1">{(topicsQ.data ?? []).filter((t) => t.status === 'active').length}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Last 90 days</CardTitle><CardDescription>Each square = a day's learning</CardDescription></CardHeader>
        <CardContent>
          <div className="grid grid-cols-[repeat(15,minmax(0,1fr))] sm:grid-cols-[repeat(30,minmax(0,1fr))] gap-1">
            {heatCells.map((c) => (
              <div key={c.date} title={`${c.date}: ${c.count}`}
                className={cn('aspect-square rounded',
                  c.count === 0 ? 'bg-muted' : c.count < 2 ? 'bg-emerald-500/30' : c.count < 4 ? 'bg-emerald-500/60' : 'bg-emerald-500',
                )} />
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Topics card */}
        <Card>
          <CardHeader>
            <CardTitle>Topics</CardTitle>
            <CardDescription>Your learning queue</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {topicsQ.isLoading ? <Skeleton className="h-24" /> :
              (topicsQ.data ?? []).length === 0 ? <EmptyState title="No topics yet" /> :
              (topicsQ.data ?? []).map((t) => (
                <div key={t.id} className="flex items-center justify-between p-3 rounded-lg border group gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium break-words">{t.topic_name}</p>
                    <div className="flex gap-2 mt-1 flex-wrap">
                      <Badge variant="outline">{t.level}</Badge>
                      <Badge variant="outline">P{t.priority}</Badge>
                      <Badge variant={t.status === 'active' ? 'success' : 'secondary'}>{t.status}</Badge>
                      {overdueQ.data?.[t.id] && (
                        <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/40"
                          title={`${overdueQ.data[t.id].items} pending item(s) from ${overdueQ.data[t.id].days} previous day(s)`}>
                          {overdueQ.data[t.id].items} due · {overdueQ.data[t.id].days}d
                        </Badge>
                      )}
                      {allocations[t.id] && (
                        <Badge variant="secondary">
                          {allocations[t.id].items} items · {allocations[t.id].minutes} min
                        </Badge>
                      )}
                      {t.target_completion_date && <Badge variant="outline">by {t.target_completion_date}</Badge>}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => regenM.mutate(t.id)} disabled={regenM.isPending} title="Regenerate this topic with AI">
                      <Sparkles className="h-4 w-4" /> AI
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingTopic(t)} title="Edit topic">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => deleteTopicM.mutate(t.id)} title="Delete topic">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))
            }
          </CardContent>
        </Card>

        {/* Plan card with date navigation */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <CardTitle>{planTitle}</CardTitle>
                <CardDescription>{fmtDate(viewDate)}</CardDescription>
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" onClick={() => shiftDate(-1)} title="Previous day"><ChevronLeft className="h-4 w-4" /></Button>
                <div className="relative">
                  <DatePicker value={viewDate} onChange={(v) => setViewDate(v || todayStr())}
                    trigger={(
                      <Button size="sm" variant="outline" type="button">
                        <CalendarIcon className="h-4 w-4" /> {fmtDate(viewDate)}
                      </Button>
                    )} />
                </div>
                <Button size="sm" variant="outline" onClick={() => shiftDate(1)} title="Next day"><ChevronRight className="h-4 w-4" /></Button>
                <Button size="sm" variant="outline" onClick={() => setViewDate(todayStr())}>Today</Button>
                <Button size="sm" variant="outline" onClick={() => setAddingItemFor('new')} title="Add custom item">
                  <Plus className="h-4 w-4" /> Add
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {planQ.isLoading ? <Skeleton className="h-24" /> :
              (planQ.data ?? []).length === 0 ? (
                <EmptyState title="Nothing scheduled" description="Click 'Generate plan' or add a custom item." />
              ) : (
                <AnimatePresence>
                  {sortedPlan.map((p) => {
                    const isDone = p.status === 'completed';
                    const isSkipped = p.status === 'skipped' || p.status === 'deferred';
                    const pri = p.learning_topics?.priority ?? 3;
                    const tgt = p.learning_topics?.target_completion_date;
                    const daysLeft = tgt ? Math.round((new Date(tgt + 'T00:00:00Z').getTime() - new Date(viewDate + 'T00:00:00Z').getTime()) / 86400000) : null;
                    const isHighPriority = pri >= 4 || (daysLeft !== null && daysLeft <= 7);
                    return (
                      <motion.div key={p.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className={cn('p-3 rounded-lg border', (isDone || isSkipped) && 'opacity-60 bg-muted/40', isHighPriority && !isDone && !isSkipped && 'border-red-500/60 bg-red-500/5')}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className={cn('font-medium break-words flex items-center gap-2', (isDone || isSkipped) && 'line-through')}>
                              {isHighPriority && !isDone && !isSkipped && (
                                <Flag className="h-4 w-4 text-red-500 shrink-0" aria-label="High priority" />
                              )}
                              <span>{p.title}</span>
                            </p>
                            {p.description && <p className="text-sm text-muted-foreground mt-0.5 break-words">{p.description}</p>}
                            <div className="flex flex-wrap gap-2 mt-2">
                              <Badge variant="outline">{p.learning_topics?.topic_name}</Badge>
                              <Badge variant="secondary">{p.estimated_minutes} min</Badge>
                              <Badge variant={p.source === 'manual' ? 'outline' : 'secondary'}>
                                {p.source === 'manual' ? 'manual' : 'AI'}
                              </Badge>
                              {isHighPriority && !isDone && !isSkipped && (
                                <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/40">
                                  {pri >= 4 && daysLeft !== null && daysLeft <= 7 ? `P${pri} · ${daysLeft}d left` : pri >= 4 ? `P${pri} high` : `${daysLeft}d left`}
                                </Badge>
                              )}
                              {p.status !== 'pending' && <Badge variant="outline">{p.status}</Badge>}
                              {(p.resource_links ?? []).map((r, i) => (
                                <a key={i} href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline break-all">
                                  <ExternalLink className="h-3 w-3" /> {r.label}
                                </a>
                              ))}
                            </div>
                          </div>
                          <div className="flex flex-col gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setEditingItem(p)} title="Edit item"><Pencil className="h-4 w-4" /></Button>
                            <Button size="sm" variant="ghost" onClick={() => deletePlanItemM.mutate(p.id)} title="Delete item"><Trash2 className="h-4 w-4" /></Button>
                          </div>
                        </div>
                        <div className="flex gap-2 mt-2 flex-wrap">
                          {isSkipped ? (
                            <Button size="sm" variant="outline" onClick={() => updatePlanItemM.mutate({ id: p.id, status: 'pending' })}>
                              <Undo2 className="h-4 w-4" /> Restore
                            </Button>
                          ) : (
                            <>
                              <Button size="sm" variant={isDone ? 'secondary' : 'default'}
                                onClick={() => updatePlanItemM.mutate({ id: p.id, status: isDone ? 'pending' : 'completed' })}>
                                <CheckCircle2 className="h-4 w-4" /> {isDone ? 'Undo' : 'Complete'}
                              </Button>
                              {!isDone && (
                                <>
                                  <Button size="sm" variant="outline" onClick={() => skipWithUndo(p)}>
                                    <SkipForward className="h-4 w-4" /> Skip
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={() => deferM.mutate(p.id)} disabled={deferM.isPending} title="Move this task to tomorrow">
                                    <CalendarClock className="h-4 w-4" /> Defer
                                  </Button>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              )
            }
          </CardContent>
        </Card>
      </div>

      {/* Edit topic dialog */}
      <Dialog open={!!editingTopic} onOpenChange={(v) => !v && setEditingTopic(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit topic</DialogTitle></DialogHeader>
          {editingTopic && (
            <TopicForm
              initial={editingTopic}
              onDone={() => { setEditingTopic(null); qc.invalidateQueries({ queryKey: ['topics', userId] }); }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Add custom item dialog */}
      <Dialog open={addingItemFor === 'new'} onOpenChange={(v) => !v && setAddingItemFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add plan item — {fmtDate(viewDate)}</DialogTitle></DialogHeader>
          <PlanItemForm
            date={viewDate}
            topics={topicsQ.data ?? []}
            onDone={() => { setAddingItemFor(null); qc.invalidateQueries({ queryKey: ['plan', userId, viewDate] }); }}
          />
        </DialogContent>
      </Dialog>

      {/* Edit item dialog */}
      <Dialog open={!!editingItem} onOpenChange={(v) => !v && setEditingItem(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit plan item</DialogTitle></DialogHeader>
          {editingItem && (
            <PlanItemForm
              date={editingItem.date}
              topics={topicsQ.data ?? []}
              initial={editingItem}
              onDone={() => { setEditingItem(null); qc.invalidateQueries({ queryKey: ['plan', userId, viewDate] }); }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ----- Topic create/edit form -----

function TopicForm({ initial, onDone }: { initial?: Topic; onDone: () => void }) {
  const { session } = useSession();
  const [name, setName] = useState(initial?.topic_name ?? '');
  const [level, setLevel] = useState<Topic['level']>(initial?.level ?? 'beginner');
  const [priority, setPriority] = useState(initial?.priority ?? 3);
  const [status, setStatus] = useState<Topic['status']>(initial?.status ?? 'active');
  const [target, setTarget] = useState(initial?.target_completion_date ?? '');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setBusy(true);
    const payload = {
      topic_name: name, level, priority, status,
      target_completion_date: target || null,
    };
    const { error } = initial
      ? await supabase.from('learning_topics').update(payload).eq('id', initial.id)
      : await supabase.from('learning_topics').insert({ ...payload, user_id: session.user.id });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(initial ? 'Topic updated' : 'Topic added');
    onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5"><Label>Topic name</Label><Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rust ownership" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Level</Label>
          <select value={level} onChange={(e) => setLevel(e.target.value as Topic['level'])} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
            <option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option>
          </select>
        </div>
        <div className="space-y-1.5"><Label>Priority (1–5)</Label><Input type="number" min={1} max={5} value={priority} onChange={(e) => setPriority(Number(e.target.value))} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Status</Label>
          <select value={status} onChange={(e) => setStatus(e.target.value as Topic['status'])} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
            <option value="active">Active</option><option value="paused">Paused</option><option value="completed">Completed</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Target completion</Label>
          <DatePicker value={target} onChange={setTarget} placeholder="Pick a date" />
        </div>
      </div>
      <DialogFooter>
        <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : initial ? 'Save' : 'Add topic'}</Button>
      </DialogFooter>
    </form>
  );
}

// ----- Plan item create/edit form (manual or edit AI) -----

function PlanItemForm({
  date, topics, initial, onDone,
}: { date: string; topics: Topic[]; initial?: PlanRow; onDone: () => void }) {
  const { session } = useSession();
  const firstTopic = topics[0]?.id ?? '';
  const [topicId, setTopicId] = useState<string>(initial?.topic_id ?? firstTopic);
  const [creatingTopic, setCreatingTopic] = useState(false);
  const [newTopicName, setNewTopicName] = useState('');
  const [newTopicLevel, setNewTopicLevel] = useState<Topic['level']>('beginner');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [minutes, setMinutes] = useState(initial?.estimated_minutes ?? 30);
  const [links, setLinks] = useState<ResLink[]>(initial?.resource_links?.length ? initial.resource_links : [{ label: '', url: '' }]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!topicId && firstTopic) setTopicId(firstTopic); }, [firstTopic, topicId]);

  function setLink(i: number, patch: Partial<ResLink>) {
    setLinks((xs) => xs.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }
  function addLink() { setLinks((xs) => [...xs, { label: '', url: '' }]); }
  function removeLink(i: number) { setLinks((xs) => xs.filter((_, idx) => idx !== i)); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setBusy(true);
    let effectiveTopicId = topicId;
    if (creatingTopic) {
      const name = newTopicName.trim();
      if (!name) { setBusy(false); return toast.error('Enter a topic name'); }
      const { data, error } = await supabase.from('learning_topics').insert({
        user_id: session.user.id, topic_name: name, level: newTopicLevel,
        priority: 3, status: 'active',
      }).select('id').single();
      if (error || !data) { setBusy(false); return toast.error(error?.message || 'Could not create topic'); }
      effectiveTopicId = data.id;
    }
    if (!effectiveTopicId) { setBusy(false); return toast.error('Pick or create a topic'); }
    const cleanLinks = links.filter((l) => l.url.trim()).map((l) => ({ label: l.label.trim() || l.url, url: l.url.trim() }));
    const payload = {
      topic_id: effectiveTopicId,
      title: title.trim(),
      description: description.trim() || null,
      estimated_minutes: Math.max(1, Number(minutes) || 30),
      resource_links: cleanLinks,
    };
    if (initial) {
      const { error } = await supabase.from('learning_plans').update(payload).eq('id', initial.id);
      setBusy(false);
      if (error) return toast.error(error.message);
      toast.success('Item updated');
    } else {
      const { error } = await supabase.from('learning_plans').insert({
        ...payload,
        user_id: session.user.id,
        date,
        order_in_day: 999,
        status: 'pending',
        ai_generated: false,
        source: 'manual',
      });
      setBusy(false);
      if (error) return toast.error(error.message);
      toast.success('Item added');
    }
    onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>Topic</Label>
          <button type="button" className="text-xs text-primary hover:underline"
            onClick={() => setCreatingTopic((v) => !v)}>
            {creatingTopic ? 'Pick existing' : '+ New topic'}
          </button>
        </div>
        {creatingTopic ? (
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Input autoFocus required value={newTopicName} onChange={(e) => setNewTopicName(e.target.value)}
              placeholder="e.g. Kubernetes operators" />
            <select value={newTopicLevel} onChange={(e) => setNewTopicLevel(e.target.value as Topic['level'])}
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm">
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>
        ) : (
          <select value={topicId} onChange={(e) => setTopicId(e.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
            {topics.length === 0 && <option value="">No topics yet — click '+ New topic'</option>}
            {topics.map((t) => <option key={t.id} value={t.id}>{t.topic_name}</option>)}
          </select>
        )}
      </div>
      <div className="space-y-1.5"><Label>Title</Label><Input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Read chapter 4 of Effective C++" /></div>
      <div className="space-y-1.5"><Label>Description</Label><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      <div className="space-y-1.5"><Label>Estimated minutes</Label><Input type="number" min={1} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /></div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>Reference links</Label>
          <Button type="button" size="sm" variant="ghost" onClick={addLink}><Plus className="h-3 w-3" /> Add link</Button>
        </div>
        <div className="space-y-2">
          {links.map((l, i) => (
            <div key={i} className="flex gap-2">
              <Input placeholder="Label" value={l.label} onChange={(e) => setLink(i, { label: e.target.value })} />
              <Input placeholder="https://…" value={l.url} onChange={(e) => setLink(i, { url: e.target.value })} />
              <Button type="button" size="sm" variant="ghost" onClick={() => removeLink(i)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>
      </div>
      <DialogFooter>
        <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : initial ? 'Save' : 'Add item'}</Button>
      </DialogFooter>
    </form>
  );
}

// ----- Themed date picker (Calendar in a Popover) -----
function DatePicker({
  value, onChange, placeholder, trigger,
}: {
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(value + 'T00:00:00') : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <button type="button"
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-left flex items-center gap-2 hover:bg-accent/40 transition-colors">
            <CalendarIcon className="h-4 w-4 text-muted-foreground" />
            {value ? fmtDate(value) : <span className="text-muted-foreground">{placeholder ?? 'Pick a date'}</span>}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(d) => {
            if (d) {
              const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              onChange(iso);
              setOpen(false);
            } else {
              onChange('');
            }
          }}
          initialFocus
        />
        <div className="flex items-center justify-between border-t border-border p-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => { onChange(''); setOpen(false); }}>Clear</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => { onChange(todayStr()); setOpen(false); }}>Today</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
