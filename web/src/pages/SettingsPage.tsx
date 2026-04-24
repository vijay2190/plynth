import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Download, Send, Smartphone, Copy, X } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Loader';
import { Switch } from '@/components/ui/Switch';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/useSession';
import { useTheme } from '@/app/ThemeProvider';
import { cn } from '@/lib/utils';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function SettingsPage() {
  const { session } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const { theme, setTheme } = useTheme();

  const profileQ = useQuery({
    queryKey: ['profile-settings', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('*').eq('user_id', userId!).maybeSingle();
      return data;
    },
  });

  const remindersQ = useQuery({
    queryKey: ['reminder_settings', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('reminder_settings').select('*').eq('user_id', userId!).order('time_of_day');
      return data ?? [];
    },
  });

  const [profileF, setProfileF] = useState({ full_name: '', timezone: '' });
  const [learnF, setLearnF] = useState<{ daily_plan_max_items: number; budget_enabled: boolean; daily_plan_budget_hours: number }>({
    daily_plan_max_items: 8, budget_enabled: false, daily_plan_budget_hours: 1.5,
  });
  useEffect(() => {
    if (profileQ.data) {
      setProfileF({
        full_name: profileQ.data.full_name ?? '',
        timezone: profileQ.data.timezone ?? 'Asia/Kolkata',
      });
      const min = profileQ.data.daily_plan_budget_min;
      setLearnF({
        daily_plan_max_items: profileQ.data.daily_plan_max_items ?? 8,
        budget_enabled: min != null,
        daily_plan_budget_hours: min != null ? Math.round((min / 60) * 4) / 4 : 1.5,
      });
    }
  }, [profileQ.data]);

  async function saveLearning(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    const max = Math.max(1, Math.min(30, Number(learnF.daily_plan_max_items) || 8));
    let budgetMin: number | null = null;
    if (learnF.budget_enabled) {
      const hours = Math.max(0.25, Math.min(8, Number(learnF.daily_plan_budget_hours) || 1.5));
      budgetMin = Math.round(hours * 60);
    }
    const { error } = await supabase.from('profiles').update({
      daily_plan_max_items: max, daily_plan_budget_min: budgetMin,
    }).eq('user_id', userId);
    if (error) return toast.error(error.message);
    toast.success('Learning preferences saved');
    qc.invalidateQueries({ queryKey: ['profile-settings', userId] });
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    const { error } = await supabase.from('profiles').update(profileF).eq('user_id', userId);
    if (error) return toast.error(error.message);
    toast.success('Profile saved');
    qc.invalidateQueries({ queryKey: ['profile-settings', userId] });
  }

  const addReminderM = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('reminder_settings').insert({
        user_id: userId!, category: 'tasks', channel: 'both', time_of_day: '07:00',
        times_of_day: ['07:00:00'], days_of_week: [1,2,3,4,5], enabled: true,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reminder_settings', userId] }),
  });

  const updateReminderM = useMutation({
    mutationFn: async (r: any) => {
      // Mirror first time into the legacy time_of_day column for back-compat.
      const patch: any = { ...r };
      if (Array.isArray(r.times_of_day) && r.times_of_day.length) {
        patch.time_of_day = r.times_of_day[0];
      }
      const { error } = await supabase.from('reminder_settings').update(patch).eq('id', r.id);
      if (error) throw error;
    },
    onMutate: async (r: any) => {
      // Optimistic update so the toggle/checkbox state never lags behind
      await qc.cancelQueries({ queryKey: ['reminder_settings', userId] });
      const prev = qc.getQueryData<any[]>(['reminder_settings', userId]);
      qc.setQueryData<any[]>(['reminder_settings', userId], (old) =>
        (old ?? []).map((x) => (x.id === r.id ? { ...x, ...r } : x))
      );
      return { prev };
    },
    onError: (_e, _r, ctx) => {
      if (ctx?.prev) qc.setQueryData(['reminder_settings', userId], ctx.prev);
      toast.error('Could not save reminder');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['reminder_settings', userId] }),
  });

  const testReminderM = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke('send-reminder', {
        body: { test_reminder_id: id },
      });
      if (error) throw error;
      return data as { ok: boolean; channel: string };
    },
    onSuccess: (res) => {
      if (res.ok) toast.success(`Test sent via ${res.channel}`);
      else toast.error('Test failed — check email_log');
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const deleteReminderM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('reminder_settings').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reminder_settings', userId] }); toast.success('Removed'); },
  });

  async function exportData() {
    if (!userId) return;
    const tables = ['profiles', 'learning_topics', 'learning_plans', 'learning_streaks', 'job_settings', 'job_listings', 'job_applications', 'resumes', 'task_categories', 'tasks', 'loans', 'emi_payments', 'reminder_settings'] as const;
    const out: Record<string, unknown> = { exported_at: new Date().toISOString() };
    for (const t of tables) {
      const { data } = await supabase.from(t).select('*');
      out[t] = data ?? [];
    }
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `plynth-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
        <CardContent>
          {profileQ.isLoading ? <Skeleton className="h-32" /> : (
            <form onSubmit={saveProfile} className="space-y-3">
              <div className="space-y-1.5"><Label>Full name</Label><Input value={profileF.full_name} onChange={e => setProfileF({ ...profileF, full_name: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Email</Label><Input value={profileQ.data?.email ?? ''} disabled /></div>
              <div className="space-y-1.5"><Label>Timezone</Label><Input value={profileF.timezone} onChange={e => setProfileF({ ...profileF, timezone: e.target.value })} /></div>
              <Button type="submit">Save profile</Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Theme</CardTitle></CardHeader>
        <CardContent className="flex gap-2">
          {(['light', 'dark', 'system'] as const).map(t => (
            <Button key={t} variant={theme === t ? 'default' : 'outline'} onClick={() => setTheme(t)}>{t}</Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Learning</CardTitle>
          <CardDescription>Controls how AI builds your daily study plan.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveLearning} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Max items per day (1–30)</Label>
                <Input type="number" min={1} max={30} value={learnF.daily_plan_max_items}
                  onChange={e => setLearnF({ ...learnF, daily_plan_max_items: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Daily hours (0.25–8)</Label>
                  <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
                    <input type="checkbox" checked={learnF.budget_enabled}
                      onChange={e => setLearnF({ ...learnF, budget_enabled: e.target.checked })} />
                    Cap study time
                  </label>
                </div>
                <Input type="number" min={0.25} max={8} step={0.25}
                  disabled={!learnF.budget_enabled}
                  value={learnF.daily_plan_budget_hours}
                  onChange={e => setLearnF({ ...learnF, daily_plan_budget_hours: Number(e.target.value) })} />
                <p className="text-xs text-muted-foreground">
                  {learnF.budget_enabled
                    ? `Plan capped at ~${Math.round(learnF.daily_plan_budget_hours * 60)} min/day.`
                    : 'No time cap — only "Max items per day" applies.'}
                </p>
              </div>
            </div>
            <Button type="submit">Save learning preferences</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Reminders</CardTitle>
              <CardDescription>Per-category schedule. Email goes via the mail bridge (Gmail) with Resend fallback. Push goes via ntfy.sh (per-user topic below).</CardDescription>
            </div>
            <Button size="sm" onClick={() => addReminderM.mutate()}><Plus className="h-4 w-4" /> Add</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Per-user ntfy topic + subscribe instructions */}
          {profileQ.data?.ntfy_topic && (
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium"><Smartphone className="h-4 w-4" /> Your push topic</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-2 py-1.5 rounded bg-background border text-xs break-all">{profileQ.data.ntfy_topic}</code>
                <Button size="sm" variant="outline" onClick={() => {
                  navigator.clipboard.writeText(profileQ.data.ntfy_topic);
                  toast.success('Copied');
                }}><Copy className="h-3.5 w-3.5" /></Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Subscribe in the <a className="underline" href="https://ntfy.sh/app" target="_blank" rel="noreferrer">ntfy web app</a>{' '}
                or install the <a className="underline" href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noreferrer">Android app</a>{' '}
                / <a className="underline" href="https://apps.apple.com/us/app/ntfy/id1625396347" target="_blank" rel="noreferrer">iOS app</a>{' '}
                and add this topic.
              </p>
              <a href={`https://ntfy.sh/${profileQ.data.ntfy_topic}`} target="_blank" rel="noreferrer"
                className="inline-block text-xs text-primary underline">Open ntfy.sh/{profileQ.data.ntfy_topic} →</a>
            </div>
          )}

          {remindersQ.isLoading ? <Skeleton className="h-24" /> :
            (remindersQ.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No reminders configured.</p> :
            (remindersQ.data ?? []).map((r: any) => {
              const times: string[] = (r.times_of_day && r.times_of_day.length) ? r.times_of_day : [r.time_of_day ?? '07:00:00'];
              return (
                <div key={r.id} className={cn('rounded-lg border p-3 space-y-3 transition-opacity', !r.enabled && 'opacity-50')}>
                  {/* Header row: enabled toggle + delete */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Switch checked={!!r.enabled} onCheckedChange={(v) => updateReminderM.mutate({ ...r, enabled: v })} aria-label="Enable reminder" />
                      <span className="text-sm font-medium">{r.enabled ? 'Enabled' : 'Disabled'}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="outline" disabled={!r.enabled || testReminderM.isPending}
                        onClick={() => testReminderM.mutate(r.id)} title="Send a test reminder right now">
                        <Send className="h-3.5 w-3.5" /> Test
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => deleteReminderM.mutate(r.id)} title="Delete reminder">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <fieldset disabled={!r.enabled} className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1"><Label className="text-xs">Category</Label>
                        <select value={r.category} onChange={e => updateReminderM.mutate({ ...r, category: e.target.value })} className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm disabled:opacity-50">
                          <option value="tasks">Tasks digest</option>
                          <option value="learning">Learning plan</option>
                          <option value="finance">EMI due</option>
                          <option value="jobs">New jobs</option>
                          <option value="all">All-in-one digest</option>
                        </select>
                      </div>
                      <div className="space-y-1"><Label className="text-xs">Channel</Label>
                        <select value={r.channel} onChange={e => updateReminderM.mutate({ ...r, channel: e.target.value })} className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm disabled:opacity-50">
                          <option value="email">Email</option><option value="ntfy">Push (ntfy)</option><option value="both">Both</option>
                        </select>
                      </div>
                    </div>

                    {/* Multiple times of day */}
                    <div className="space-y-1">
                      <Label className="text-xs">Times of day</Label>
                      <div className="flex flex-wrap gap-2 items-center">
                        {times.map((t, idx) => (
                          <div key={idx} className="flex items-center gap-1 border rounded-lg pl-2 pr-1 py-0.5 bg-background">
                            <Input
                              type="time"
                              value={t.slice(0, 5)}
                              className="h-7 w-[88px] border-0 px-1 focus-visible:ring-0"
                              onChange={(e) => {
                                const next = [...times];
                                next[idx] = `${e.target.value}:00`;
                                updateReminderM.mutate({ ...r, times_of_day: dedupeSorted(next) });
                              }}
                            />
                            {times.length > 1 && (
                              <button
                                type="button"
                                className="p-0.5 hover:bg-muted rounded"
                                title="Remove time"
                                onClick={() => {
                                  const next = times.filter((_, i) => i !== idx);
                                  updateReminderM.mutate({ ...r, times_of_day: next });
                                }}
                              ><X className="h-3 w-3" /></button>
                            )}
                          </div>
                        ))}
                        <Button size="sm" variant="outline" onClick={() => {
                          const next = dedupeSorted([...times, '12:00:00']);
                          updateReminderM.mutate({ ...r, times_of_day: next });
                        }}><Plus className="h-3 w-3" /> Add time</Button>
                      </div>
                    </div>

                    {/* Day-of-week chips */}
                    <div className="space-y-1">
                      <Label className="text-xs">Days</Label>
                      <div className="flex gap-1 flex-wrap">
                        {DAY_LABELS.map((d, i) => {
                          const active = (r.days_of_week as number[]).includes(i);
                          return (
                            <button key={d} type="button" disabled={!r.enabled} onClick={() => {
                              const next = active ? r.days_of_week.filter((x: number) => x !== i) : [...r.days_of_week, i].sort();
                              updateReminderM.mutate({ ...r, days_of_week: next });
                            }} className={`px-2 py-0.5 rounded text-xs ${active ? 'bg-primary text-primary-foreground' : 'bg-secondary'}`}>{d}</button>
                          );
                        })}
                      </div>
                    </div>
                  </fieldset>
                </div>
              );
            })
          }
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>API keys</CardTitle><CardDescription>Stored in Supabase Vault, set via CLI by admin. Read-only here.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          {[
            { k: 'GEMINI_API_KEY', label: 'Google Gemini' },
            { k: 'RAPIDAPI_JSEARCH_KEY', label: 'RapidAPI JSearch' },
            { k: 'RESEND_API_KEY', label: 'Resend (email fallback)' },
            { k: 'MAIL_BRIDGE_URL', label: 'Mail bridge URL' },
            { k: 'NTFY_TOPIC', label: 'ntfy.sh topic' },
          ].map(s => (
            <div key={s.k} className="flex items-center justify-between text-sm">
              <span>{s.label}</span><Badge variant="outline">configured server-side</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Data</CardTitle></CardHeader>
        <CardContent>
          <Button variant="outline" onClick={exportData}><Download className="h-4 w-4" /> Export all data (JSON)</Button>
        </CardContent>
      </Card>
    </div>
  );
}

function dedupeSorted(times: string[]): string[] {
  return Array.from(new Set(times)).sort();
}
