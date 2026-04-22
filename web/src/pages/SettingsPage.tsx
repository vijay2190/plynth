import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Loader';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/useSession';
import { useTheme } from '@/app/ThemeProvider';

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
  if (profileQ.data && !profileF.full_name && !profileF.timezone) {
    setProfileF({ full_name: profileQ.data.full_name ?? '', timezone: profileQ.data.timezone });
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
        user_id: userId!, category: 'tasks', channel: 'both', time_of_day: '07:00', days_of_week: [1,2,3,4,5], enabled: true,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reminder_settings', userId] }),
  });

  const updateReminderM = useMutation({
    mutationFn: async (r: any) => {
      const { error } = await supabase.from('reminder_settings').update(r).eq('id', r.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reminder_settings', userId] }),
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
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Reminders</CardTitle>
              <CardDescription>Per-category schedule. Email goes via the mail bridge (Gmail) with Resend fallback. Push goes via ntfy.sh.</CardDescription>
            </div>
            <Button size="sm" onClick={() => addReminderM.mutate()}><Plus className="h-4 w-4" /> Add</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {remindersQ.isLoading ? <Skeleton className="h-24" /> :
            (remindersQ.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No reminders configured.</p> :
            (remindersQ.data ?? []).map((r: any) => (
              <div key={r.id} className="rounded-lg border p-3 space-y-2">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                  <div className="space-y-1"><Label className="text-xs">Category</Label>
                    <select value={r.category} onChange={e => updateReminderM.mutate({ ...r, category: e.target.value })} className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm">
                      <option value="tasks">Tasks digest</option>
                      <option value="learning">Learning plan</option>
                      <option value="finance">EMI due</option>
                      <option value="jobs">New jobs</option>
                      <option value="all">All-in-one digest</option>
                    </select>
                  </div>
                  <div className="space-y-1"><Label className="text-xs">Channel</Label>
                    <select value={r.channel} onChange={e => updateReminderM.mutate({ ...r, channel: e.target.value })} className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm">
                      <option value="email">Email</option><option value="ntfy">Push (ntfy)</option><option value="both">Both</option>
                    </select>
                  </div>
                  <div className="space-y-1"><Label className="text-xs">Time</Label>
                    <Input type="time" value={r.time_of_day?.slice(0,5)} onChange={e => updateReminderM.mutate({ ...r, time_of_day: `${e.target.value}:00` })} />
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={r.enabled} onChange={e => updateReminderM.mutate({ ...r, enabled: e.target.checked })} /> Enabled
                    </label>
                    <Button size="icon" variant="ghost" onClick={() => deleteReminderM.mutate(r.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
                <div className="flex gap-1 flex-wrap">
                  {DAY_LABELS.map((d, i) => {
                    const active = (r.days_of_week as number[]).includes(i);
                    return (
                      <button key={d} type="button" onClick={() => {
                        const next = active ? r.days_of_week.filter((x: number) => x !== i) : [...r.days_of_week, i].sort();
                        updateReminderM.mutate({ ...r, days_of_week: next });
                      }} className={`px-2 py-0.5 rounded text-xs ${active ? 'bg-primary text-primary-foreground' : 'bg-secondary'}`}>{d}</button>
                    );
                  })}
                </div>
              </div>
            ))
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
