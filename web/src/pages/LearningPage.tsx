import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Sparkles, CheckCircle2, SkipForward, CalendarClock, Flame, ExternalLink, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Loader';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/useSession';
import { ai } from '@/lib/ai-provider';
import { cn } from '@/lib/utils';

export function LearningPage() {
  const { session } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const topicsQ = useQuery({
    queryKey: ['topics', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('learning_topics').select('*').eq('user_id', userId!).order('priority', { ascending: false });
      return data ?? [];
    },
  });

  const planQ = useQuery({
    queryKey: ['plan', userId, today],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('learning_plans').select('*, learning_topics(topic_name)')
        .eq('user_id', userId!).eq('date', today).order('order_in_day');
      return data ?? [];
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

  const updatePlanItemM = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from('learning_plans').update({
        status, completed_at: status === 'completed' ? new Date().toISOString() : null,
      }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['plan', userId, today] }); qc.invalidateQueries({ queryKey: ['heat', userId] }); },
  });

  const regenM = useMutation({
    mutationFn: async (topicId: string) => ai.generateLearningPlan(topicId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['plan', userId, today] }); toast.success('Plan regenerated'); },
    onError: (e) => toast.error((e as Error).message),
  });

  const deleteTopicM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('learning_topics').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['topics', userId] }); toast.success('Topic removed'); },
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

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Learning Hub</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4" /> Add Topic</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add learning topic</DialogTitle></DialogHeader>
            <NewTopicForm onCreated={() => { setOpen(false); qc.invalidateQueries({ queryKey: ['topics', userId] }); }} />
          </DialogContent>
        </Dialog>
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
            <p className="text-2xl font-bold mt-1">{(topicsQ.data ?? []).filter(t => t.status === 'active').length}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Last 90 days</CardTitle><CardDescription>Each square = a day's learning</CardDescription></CardHeader>
        <CardContent>
          <div className="grid grid-cols-[repeat(15,minmax(0,1fr))] sm:grid-cols-[repeat(30,minmax(0,1fr))] gap-1">
            {heatCells.map(c => (
              <div key={c.date} title={`${c.date}: ${c.count}`}
                className={cn('aspect-square rounded',
                  c.count === 0 ? 'bg-muted' : c.count < 2 ? 'bg-emerald-500/30' : c.count < 4 ? 'bg-emerald-500/60' : 'bg-emerald-500',
                )} />
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Topics</CardTitle>
            <CardDescription>Your learning queue</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {topicsQ.isLoading ? <Skeleton className="h-24" /> :
              (topicsQ.data ?? []).length === 0 ? <EmptyState title="No topics yet" /> :
              (topicsQ.data ?? []).map((t: any) => (
                <div key={t.id} className="flex items-center justify-between p-3 rounded-lg border group">
                  <div>
                    <p className="font-medium">{t.topic_name}</p>
                    <div className="flex gap-2 mt-1">
                      <Badge variant="outline">{t.level}</Badge>
                      <Badge variant={t.status === 'active' ? 'success' : 'secondary'}>{t.status}</Badge>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => regenM.mutate(t.id)} disabled={regenM.isPending}>
                      <Sparkles className="h-4 w-4" /> AI
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => deleteTopicM.mutate(t.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              ))
            }
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Today's Plan</CardTitle>
            <CardDescription>{today}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {planQ.isLoading ? <Skeleton className="h-24" /> :
              (planQ.data ?? []).length === 0 ? (
                <EmptyState title="Nothing scheduled" description="Add a topic and click AI to generate a plan." />
              ) : (
                <AnimatePresence>
                  {(planQ.data ?? []).map((p: any) => (
                    <motion.div key={p.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className={cn('p-3 rounded-lg border', p.status === 'completed' && 'opacity-60')}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className={cn('font-medium', p.status === 'completed' && 'line-through')}>{p.title}</p>
                          {p.description && <p className="text-sm text-muted-foreground mt-0.5">{p.description}</p>}
                          <div className="flex flex-wrap gap-2 mt-2">
                            <Badge variant="outline">{(p.learning_topics as any)?.topic_name}</Badge>
                            <Badge variant="secondary">{p.estimated_minutes} min</Badge>
                            {(p.resource_links ?? []).map((r: any, i: number) => (
                              <a key={i} href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                                <ExternalLink className="h-3 w-3" /> {r.label}
                              </a>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-2">
                        <Button size="sm" variant={p.status === 'completed' ? 'secondary' : 'default'} onClick={() => updatePlanItemM.mutate({ id: p.id, status: p.status === 'completed' ? 'pending' : 'completed' })}>
                          <CheckCircle2 className="h-4 w-4" /> Complete
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => updatePlanItemM.mutate({ id: p.id, status: 'skipped' })}>
                          <SkipForward className="h-4 w-4" /> Skip
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => updatePlanItemM.mutate({ id: p.id, status: 'deferred' })}>
                          <CalendarClock className="h-4 w-4" /> Defer
                        </Button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )
            }
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function NewTopicForm({ onCreated }: { onCreated: () => void }) {
  const { session } = useSession();
  const [name, setName] = useState('');
  const [level, setLevel] = useState<'beginner' | 'intermediate' | 'advanced'>('beginner');
  const [priority, setPriority] = useState(3);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setBusy(true);
    const { error } = await supabase.from('learning_topics').insert({
      user_id: session.user.id, topic_name: name, level, priority,
      status: 'active', target_completion_date: target || null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('Topic added');
    onCreated();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5"><Label>Topic name</Label><Input required value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Rust ownership" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Level</Label>
          <select value={level} onChange={e => setLevel(e.target.value as any)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
            <option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option>
          </select>
        </div>
        <div className="space-y-1.5"><Label>Priority (1–5)</Label><Input type="number" min={1} max={5} value={priority} onChange={e => setPriority(Number(e.target.value))} /></div>
      </div>
      <div className="space-y-1.5"><Label>Target completion (optional)</Label><Input type="date" value={target} onChange={e => setTarget(e.target.value)} /></div>
      <DialogFooter>
        <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add topic'}</Button>
      </DialogFooter>
    </form>
  );
}
