import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Input, Label } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/useSession';

export function OnboardingPage() {
  const { session } = useSession();
  const [fullName, setFullName] = useState('');
  const [tz, setTz] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setBusy(true);
    const { error } = await supabase.from('profiles').upsert({
      user_id: session.user.id,
      email: session.user.email ?? '',
      full_name: fullName,
      timezone: tz,
      theme_preference: 'system',
    }, { onConflict: 'user_id' });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('Profile saved');
    navigate('/', { replace: true });
  }

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Welcome to Plynth</CardTitle>
          <CardDescription>Tell us a bit about you</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Full name</Label>
              <Input id="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tz">Timezone</Label>
              <Input id="tz" value={tz} onChange={(e) => setTz(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Saving…' : 'Continue'}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
