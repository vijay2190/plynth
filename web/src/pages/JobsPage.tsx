import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { DndContext, type DragEndEvent, useDraggable, useDroppable } from '@dnd-kit/core';
import { Plus, Briefcase, RefreshCw, ExternalLink, Trash2, Sparkles, Bookmark, BookmarkCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Loader';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/useSession';
import { cn } from '@/lib/utils';

const STATUSES = ['applied', 'screening', 'interview', 'offer', 'rejected'] as const;
type AppStatus = typeof STATUSES[number];
const TABS = ['Browse', 'Saved', 'Applications', 'Settings'] as const;
type Tab = typeof TABS[number];

export function JobsPage() {
  const [tab, setTab] = useState<Tab>('Browse');
  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold">Jobs</h1>
      <div className="flex gap-2 border-b">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('px-4 py-2 text-sm font-medium border-b-2',
              tab === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>{t}</button>
        ))}
      </div>
      {tab === 'Browse' && <BrowseTab />}
      {tab === 'Saved' && <SavedTab />}
      {tab === 'Applications' && <ApplicationsTab />}
      {tab === 'Settings' && <SettingsTab />}
    </div>
  );
}

function BrowseTab() {
  const { session } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const listingsQ = useQuery({
    queryKey: ['listings', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('job_listings').select('*').eq('user_id', userId!)
        .order('fetched_at', { ascending: false }).limit(100);
      return data ?? [];
    },
  });

  const usageQ = useQuery({
    queryKey: ['api_usage', 'jsearch'],
    queryFn: async () => {
      const month = new Date().toISOString().slice(0, 7); // YYYY-MM
      const { data } = await supabase
        .from('api_usage')
        .select('count, monthly_limit')
        .eq('api_name', 'jsearch')
        .eq('month_year', month)
        .maybeSingle();
      return (data as { count: number; monthly_limit: number } | null) ?? { count: 0, monthly_limit: 200 };
    },
    refetchInterval: 30_000,
  });
  const used = usageQ.data?.count ?? 0;
  const limit = usageQ.data?.monthly_limit ?? 200;
  const quotaReached = used >= limit;

  async function refresh() {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-jobs', { body: {} });
      if (error) {
        // supabase-js wraps errors; try to read function's body for the real message.
        let detail = error.message;
        try {
          const ctx = (error as { context?: Response }).context;
          if (ctx && typeof ctx.json === 'function') {
            const body = await ctx.json();
            detail = body?.error ?? detail;
          }
        } catch { /* ignore */ }
        throw new Error(detail);
      }
      const inserted = (data as { inserted?: number } | null)?.inserted ?? 0;
      toast.success(inserted > 0 ? `${inserted} new listings` : 'No new listings');
      qc.invalidateQueries({ queryKey: ['listings', userId] });
      qc.invalidateQueries({ queryKey: ['api_usage', 'jsearch'] });
    } catch (e) { toast.error((e as Error).message); }
    finally { setRefreshing(false); }
  }

  const applyM = useMutation({
    mutationFn: async (l: any) => {
      const { error } = await supabase.from('job_applications').insert({
        user_id: userId!, company: l.company, role: l.title, job_url: l.job_url,
        applied_date: new Date().toISOString().slice(0, 10), status: 'applied',
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['applications'] }); toast.success('Marked as applied'); },
  });

  const saveM = useMutation({
    mutationFn: async ({ id, is_saved }: { id: string; is_saved: boolean }) => {
      const { error } = await supabase.from('job_listings').update({ is_saved }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['listings', userId] }); qc.invalidateQueries({ queryKey: ['saved-listings', userId] }); },
  });

  const deleteM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('job_listings').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['listings', userId] }); toast.success('Removed'); },
  });

  return (
    <>
      <div className="flex justify-between gap-2 flex-wrap items-center">
        <div className="text-sm text-muted-foreground">
          <span>{(listingsQ.data ?? []).length} listings</span>
          <span className="mx-2">·</span>
          <span className={cn(quotaReached && 'text-destructive font-medium')}>
            API quota: {used} / {limit} this month
          </span>
        </div>
        <Button
          size="sm"
          onClick={refresh}
          disabled={refreshing || quotaReached}
          title={quotaReached ? 'Monthly JSearch quota reached — resets on the 1st' : 'Fetch new listings'}
        >
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} /> Refresh
        </Button>
      </div>
      {listingsQ.isLoading ? <Skeleton className="h-40" /> :
        (listingsQ.data ?? []).length === 0 ? (
          <EmptyState icon={Briefcase} title="No listings yet" description="Configure your search in Settings, then click Refresh." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {listingsQ.data!.map((l: any) => (
              <motion.div key={l.id} layout>
                <Card className="overflow-hidden">
                  <CardContent className="p-4">
                    <div className="flex justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold truncate">{l.title}</p>
                        <p className="text-sm text-muted-foreground truncate">{l.company}</p>
                      </div>
                      {l.is_new && <Badge variant="success">New</Badge>}
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <Badge variant="outline">{l.source}</Badge>
                      {l.location && <Badge variant="secondary">{l.location}</Badge>}
                      {l.salary_range && <Badge variant="secondary">{l.salary_range}</Badge>}
                    </div>
                    {l.description_snippet && <p className="text-sm text-muted-foreground mt-2 line-clamp-2 break-words">{l.description_snippet}</p>}
                    <div className="flex gap-2 mt-3 flex-wrap">
                      <a href={l.job_url} target="_blank" rel="noreferrer">
                        <Button size="sm" variant="outline"><ExternalLink className="h-4 w-4" /> View</Button>
                      </a>
                      <Button size="sm" variant="outline" onClick={() => saveM.mutate({ id: l.id, is_saved: !l.is_saved })} title={l.is_saved ? 'Unsave' : 'Save'}>
                        {l.is_saved ? <BookmarkCheck className="h-4 w-4 text-primary" /> : <Bookmark className="h-4 w-4" />}
                      </Button>
                      <Button size="sm" onClick={() => applyM.mutate(l)}>Mark applied</Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteM.mutate(l.id)} title="Remove">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )
      }
    </>
  );
}

function SavedTab() {
  const { session } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();

  const savedQ = useQuery({
    queryKey: ['saved-listings', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('job_listings').select('*')
        .eq('user_id', userId!).eq('is_saved', true)
        .order('fetched_at', { ascending: false });
      return data ?? [];
    },
  });

  const unsaveM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('job_listings').update({ is_saved: false }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['saved-listings', userId] }); qc.invalidateQueries({ queryKey: ['listings', userId] }); },
  });

  const applyM = useMutation({
    mutationFn: async (l: any) => {
      const { error } = await supabase.from('job_applications').insert({
        user_id: userId!, company: l.company, role: l.title, job_url: l.job_url,
        applied_date: new Date().toISOString().slice(0, 10), status: 'applied',
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['applications'] }); toast.success('Marked as applied'); },
  });

  return (
    <>
      <p className="text-sm text-muted-foreground">{(savedQ.data ?? []).length} saved</p>
      {savedQ.isLoading ? <Skeleton className="h-40" /> :
        (savedQ.data ?? []).length === 0 ? (
          <EmptyState icon={Bookmark} title="No saved jobs yet" description="Click the bookmark icon on any listing in Browse to save it here." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {savedQ.data!.map((l: any) => (
              <motion.div key={l.id} layout>
                <Card className="overflow-hidden">
                  <CardContent className="p-4">
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{l.title}</p>
                      <p className="text-sm text-muted-foreground truncate">{l.company}</p>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <Badge variant="outline">{l.source}</Badge>
                      {l.location && <Badge variant="secondary">{l.location}</Badge>}
                      {l.salary_range && <Badge variant="secondary">{l.salary_range}</Badge>}
                    </div>
                    {l.description_snippet && <p className="text-sm text-muted-foreground mt-2 line-clamp-2 break-words">{l.description_snippet}</p>}
                    <div className="flex gap-2 mt-3 flex-wrap">
                      <a href={l.job_url} target="_blank" rel="noreferrer">
                        <Button size="sm" variant="outline"><ExternalLink className="h-4 w-4" /> View</Button>
                      </a>
                      <Button size="sm" onClick={() => applyM.mutate(l)}>Mark applied</Button>
                      <Button size="sm" variant="ghost" onClick={() => unsaveM.mutate(l.id)} title="Unsave">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )
      }
    </>
  );
}

function ApplicationsTab() {
  const { session } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const appsQ = useQuery({
    queryKey: ['applications', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('job_applications').select('*')
        .eq('user_id', userId!).order('applied_date', { ascending: false });
      return data ?? [];
    },
  });

  const moveM = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: AppStatus }) => {
      const { error } = await supabase.from('job_applications').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['applications', userId] }),
  });

  function onDragEnd(e: DragEndEvent) {
    if (!e.over) return;
    const id = String(e.active.id), status = String(e.over.id) as AppStatus;
    moveM.mutate({ id, status });
  }

  return (
    <>
      <div className="flex justify-between gap-2 flex-wrap">
        <p className="text-sm text-muted-foreground">{(appsQ.data ?? []).length} applications</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4" /> Add manually</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add application</DialogTitle></DialogHeader>
            <ManualAppForm onCreated={() => { setOpen(false); qc.invalidateQueries({ queryKey: ['applications', userId] }); }} />
          </DialogContent>
        </Dialog>
      </div>
      {appsQ.isLoading ? <Skeleton className="h-40" /> :
        (appsQ.data ?? []).length === 0 ? <EmptyState icon={Briefcase} title="No applications yet" /> :
        <DndContext onDragEnd={onDragEnd}>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 overflow-x-auto">
            {STATUSES.map(s => (
              <KanbanColumn key={s} status={s} apps={(appsQ.data ?? []).filter((a: any) => a.status === s)} />
            ))}
          </div>
        </DndContext>
      }
    </>
  );
}

function KanbanColumn({ status, apps }: { status: AppStatus; apps: any[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div ref={setNodeRef} className={cn('rounded-xl border p-2 min-h-[200px] bg-card transition-colors', isOver && 'ring-2 ring-primary')}>
      <div className="flex items-center justify-between px-2 py-1 mb-2">
        <span className="text-sm font-semibold capitalize">{status}</span>
        <Badge variant="secondary">{apps.length}</Badge>
      </div>
      <div className="space-y-2">
        {apps.map(a => <KanbanCard key={a.id} app={a} />)}
      </div>
    </div>
  );
}

function KanbanCard({ app }: { app: any }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: app.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 } : undefined;
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}
      className="rounded-lg border bg-background p-3 cursor-grab active:cursor-grabbing shadow-sm hover:shadow">
      <p className="font-medium text-sm truncate">{app.role}</p>
      <p className="text-xs text-muted-foreground">{app.company}</p>
      <p className="text-xs text-muted-foreground mt-1">{app.applied_date}</p>
    </div>
  );
}

function ManualAppForm({ onCreated }: { onCreated: () => void }) {
  const { session } = useSession();
  const [f, setF] = useState({ company: '', role: '', job_url: '', notes: '' });
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (!session) return;
    setBusy(true);
    const { error } = await supabase.from('job_applications').insert({
      user_id: session.user.id, ...f,
      applied_date: new Date().toISOString().slice(0, 10), status: 'applied',
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('Added'); onCreated();
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5"><Label>Company</Label><Input required value={f.company} onChange={e => setF({ ...f, company: e.target.value })} /></div>
      <div className="space-y-1.5"><Label>Role</Label><Input required value={f.role} onChange={e => setF({ ...f, role: e.target.value })} /></div>
      <div className="space-y-1.5"><Label>Job URL</Label><Input value={f.job_url} onChange={e => setF({ ...f, job_url: e.target.value })} /></div>
      <div className="space-y-1.5"><Label>Notes</Label><Textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
      <DialogFooter>
        <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add'}</Button>
      </DialogFooter>
    </form>
  );
}

function SettingsTab() {
  const { session } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const settingsQ = useQuery({
    queryKey: ['job_settings', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('job_settings').select('*').eq('user_id', userId!).maybeSingle();
      return data;
    },
  });
  const [keywords, setKeywords] = useState('');
  const [locations, setLocations] = useState('');
  const [remote, setRemote] = useState<'remote' | 'hybrid' | 'onsite' | 'any'>('any');
  useEffect(() => {
    if (settingsQ.data) {
      setKeywords((settingsQ.data.keywords ?? []).join(', '));
      setLocations((settingsQ.data.locations ?? []).join(', '));
      setRemote(settingsQ.data.remote_preference ?? 'any');
    }
  }, [settingsQ.data]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    const { error } = await supabase.from('job_settings').upsert({
      user_id: userId,
      keywords: keywords.split(',').map(s => s.trim()).filter(Boolean),
      locations: locations.split(',').map(s => s.trim()).filter(Boolean),
      preferred_roles: [], remote_preference: remote, auto_refresh: false,
    }, { onConflict: 'user_id' });
    if (error) return toast.error(error.message);
    toast.success('Saved');
    qc.invalidateQueries({ queryKey: ['job_settings', userId] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5" /> Search preferences</CardTitle>
        <CardDescription>Used when you click Refresh on the Browse tab. Free tier: 200 calls / month — auto-refresh is disabled.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-3 max-w-xl">
          <div className="space-y-1.5"><Label>Keywords (comma-separated)</Label><Input value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="DevOps Engineer, SRE, Platform" /></div>
          <div className="space-y-1.5"><Label>Locations</Label><Input value={locations} onChange={e => setLocations(e.target.value)} placeholder="Bengaluru, Remote India" /></div>
          <div className="space-y-1.5">
            <Label>Remote preference</Label>
            <select value={remote} onChange={e => setRemote(e.target.value as any)} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
              <option value="any">Any</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">Onsite</option>
            </select>
          </div>
          <Button type="submit">Save settings</Button>
        </form>
      </CardContent>
    </Card>
  );
}
