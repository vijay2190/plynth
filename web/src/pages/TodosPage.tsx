import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, CheckCircle2, Circle, Trash2, Calendar, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label, Textarea } from '@/components/ui/Input';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Loader';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/useSession';
import { cn } from '@/lib/utils';

type Priority = 'low' | 'medium' | 'high' | 'urgent';
type Status = 'pending' | 'in_progress' | 'completed' | 'cancelled';

const priorityVariant: Record<Priority, BadgeVariant> = {
  low: 'secondary', medium: 'default', high: 'warning', urgent: 'destructive',
};

const FILTERS = ['All', 'My Tasks', 'Geetha', 'Work', 'Overdue'] as const;
type Filter = typeof FILTERS[number];

function dateBucket(due: string | null, today: string, tomorrow: string, weekEnd: string): string {
  if (!due) return 'No date';
  if (due < today) return 'Overdue';
  if (due === today) return 'Today';
  if (due === tomorrow) return 'Tomorrow';
  if (due <= weekEnd) return 'This Week';
  return 'Later';
}

export function TodosPage() {
  const { session } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('All');
  const [open, setOpen] = useState(false);

  const categoriesQ = useQuery({
    queryKey: ['categories', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('task_categories').select('*').eq('user_id', userId!).order('name');
      return data ?? [];
    },
  });

  const tasksQ = useQuery({
    queryKey: ['tasks', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('tasks').select('*, task_categories(name,color,icon)')
        .eq('user_id', userId!).neq('status', 'cancelled').order('due_date', { ascending: true, nullsFirst: false });
      return data ?? [];
    },
  });

  const toggleM = useMutation({
    mutationFn: async (t: { id: string; status: Status }) => {
      const next: Status = t.status === 'completed' ? 'pending' : 'completed';
      const { error } = await supabase.from('tasks').update({ status: next, completed_at: next === 'completed' ? new Date().toISOString() : null }).eq('id', t.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', userId] }),
  });

  const deleteM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('tasks').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks', userId] }); toast.success('Task deleted'); },
  });

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const filtered = useMemo(() => {
    const all = tasksQ.data ?? [];
    if (filter === 'All') return all;
    if (filter === 'Overdue') return all.filter((t: any) => t.due_date && t.due_date < today && t.status !== 'completed');
    return all.filter((t: any) => {
      const name = (t.task_categories as any)?.name || '';
      if (filter === 'My Tasks') return name === 'My Tasks';
      if (filter === 'Geetha') return name === "Geetha's Tasks";
      if (filter === 'Work') return name === 'Work';
      return true;
    });
  }, [tasksQ.data, filter, today]);

  const grouped = useMemo(() => {
    const order = ['Overdue', 'Today', 'Tomorrow', 'This Week', 'Later', 'No date'];
    const out: Record<string, any[]> = {};
    for (const t of filtered) {
      if (t.status === 'completed') continue;
      const b = dateBucket(t.due_date, today, tomorrow, weekEnd);
      (out[b] ||= []).push(t);
    }
    return order.filter(k => out[k]?.length).map(k => [k, out[k]] as const);
  }, [filtered, today, tomorrow, weekEnd]);

  const completed = filtered.filter((t: any) => t.status === 'completed');

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-2xl font-bold">To-Do</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4" /> New Task</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create task</DialogTitle></DialogHeader>
            <NewTaskForm
              categories={categoriesQ.data ?? []}
              onCreated={() => { setOpen(false); qc.invalidateQueries({ queryKey: ['tasks', userId] }); }}
            />
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap',
              filter === f ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-accent',
            )}
          >{f}</button>
        ))}
      </div>

      {tasksQ.isLoading ? (
        <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
      ) : grouped.length === 0 && completed.length === 0 ? (
        <EmptyState icon={Calendar} title="No tasks yet" description="Create your first task to get going." />
      ) : (
        <>
          {grouped.map(([bucket, items]) => (
            <Card key={bucket}>
              <CardHeader className="pb-2">
                <CardTitle className={cn('text-sm flex items-center gap-2', bucket === 'Overdue' && 'text-destructive')}>
                  {bucket === 'Overdue' && <AlertCircle className="h-4 w-4" />} {bucket}
                  <Badge variant="secondary">{items.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <AnimatePresence>
                  {items.map((t: any) => (
                    <motion.div
                      key={t.id}
                      layout
                      initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}
                      className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-accent group"
                    >
                      <button onClick={() => toggleM.mutate({ id: t.id, status: t.status })}>
                        {t.status === 'completed' ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <Circle className="h-5 w-5 text-muted-foreground" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className={cn('text-sm font-medium truncate', t.status === 'completed' && 'line-through text-muted-foreground')}>{t.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {(t.task_categories as any)?.name && <Badge variant="outline">{(t.task_categories as any).name}</Badge>}
                          <Badge variant={priorityVariant[t.priority as Priority]}>{t.priority}</Badge>
                          {t.due_date && <span className="text-xs text-muted-foreground">{t.due_date}{t.due_time ? ` ${t.due_time.slice(0,5)}` : ''}</span>}
                        </div>
                      </div>
                      <button onClick={() => deleteM.mutate(t.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </CardContent>
            </Card>
          ))}

          {completed.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer text-sm text-muted-foreground select-none">Completed ({completed.length})</summary>
              <Card className="mt-2">
                <CardContent className="space-y-1 pt-4">
                  {completed.map((t: any) => (
                    <div key={t.id} className="flex items-center gap-3 py-1.5 group">
                      <button onClick={() => toggleM.mutate({ id: t.id, status: t.status })}>
                        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                      </button>
                      <p className="text-sm flex-1 line-through text-muted-foreground truncate">{t.title}</p>
                      <button onClick={() => deleteM.mutate(t.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function NewTaskForm({ categories, onCreated }: { categories: any[]; onCreated: () => void }) {
  const { session } = useSession();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [recurrence, setRecurrence] = useState<string>('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setBusy(true);
    const { error } = await supabase.from('tasks').insert({
      user_id: session.user.id,
      title,
      description: description || null,
      category_id: categoryId || null,
      due_date: dueDate || null,
      due_time: dueTime || null,
      priority,
      status: 'pending',
      is_recurring: !!recurrence,
      recurrence_rule: recurrence || null,
      reminder_sent: false,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('Task added');
    onCreated();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5"><Label>Title</Label><Input required value={title} onChange={e => setTitle(e.target.value)} /></div>
      <div className="space-y-1.5"><Label>Description</Label><Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Category</Label>
          <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
            <option value="">— None —</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Priority</Label>
          <select value={priority} onChange={e => setPriority(e.target.value as Priority)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5"><Label>Due date</Label><Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Due time</Label><Input type="time" value={dueTime} onChange={e => setDueTime(e.target.value)} /></div>
      </div>
      <div className="space-y-1.5">
        <Label>Recurrence (RRULE)</Label>
        <select value={recurrence} onChange={e => setRecurrence(e.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
          <option value="">No recurrence</option>
          <option value="FREQ=DAILY">Daily</option>
          <option value="FREQ=WEEKLY">Weekly</option>
          <option value="FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR">Weekdays</option>
          <option value="FREQ=MONTHLY">Monthly</option>
        </select>
      </div>
      <DialogFooter>
        <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create'}</Button>
      </DialogFooter>
    </form>
  );
}
