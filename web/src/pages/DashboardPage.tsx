import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BookOpen, Briefcase, CheckSquare, Wallet, ArrowRight, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Loader';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/useSession';
import { formatINR } from '@/lib/utils';

const QUOTES = [
  'Small steps every day beat giant leaps once a year.',
  'Discipline is choosing between what you want now and what you want most.',
  'Done is better than perfect.',
  'Compounding works on knowledge too.',
  'Show up, especially when you don\'t feel like it.',
];

export function DashboardPage() {
  const { session } = useSession();
  const userId = session?.user.id;
  const today = new Date().toISOString().slice(0, 10);
  const quote = QUOTES[new Date().getDate() % QUOTES.length];

  const learningQ = useQuery({
    queryKey: ['dashboard', 'learning', userId, today],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('learning_plans').select('id,status').eq('user_id', userId!).eq('date', today);
      return { total: data?.length ?? 0, done: data?.filter(d => d.status === 'completed').length ?? 0 };
    },
  });

  const jobsQ = useQuery({
    queryKey: ['dashboard', 'jobs', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { count } = await supabase.from('job_listings').select('*', { count: 'exact', head: true }).eq('user_id', userId!).eq('is_new', true);
      return count ?? 0;
    },
  });

  const tasksQ = useQuery({
    queryKey: ['dashboard', 'tasks', userId, today],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('tasks').select('id,status').eq('user_id', userId!).eq('due_date', today);
      return { total: data?.length ?? 0, done: data?.filter(t => t.status === 'completed').length ?? 0 };
    },
  });

  const financeQ = useQuery({
    queryKey: ['dashboard', 'finance', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('loans').select('emi_amount,emi_due_day,status').eq('user_id', userId!).eq('status', 'active');
      const totalEMI = (data ?? []).reduce((s, l) => s + Number(l.emi_amount), 0);
      const today = new Date();
      const nextDay = (data ?? [])
        .map(l => l.emi_due_day)
        .filter(d => d >= today.getDate())
        .sort((a, b) => a - b)[0];
      return { totalEMI, nextDay: nextDay ?? null };
    },
  });

  const cards = [
    {
      to: '/learning', label: "Today's Learning", icon: BookOpen, gradient: 'from-violet-500 to-fuchsia-500',
      value: learningQ.data ? `${learningQ.data.done} / ${learningQ.data.total}` : '—', sub: 'items completed',
    },
    {
      to: '/jobs', label: 'New Jobs', icon: Briefcase, gradient: 'from-sky-500 to-cyan-500',
      value: jobsQ.data?.toString() ?? '—', sub: 'fresh listings',
    },
    {
      to: '/todos', label: 'Tasks Due Today', icon: CheckSquare, gradient: 'from-emerald-500 to-teal-500',
      value: tasksQ.data ? `${tasksQ.data.done} / ${tasksQ.data.total}` : '—', sub: 'completed',
    },
    {
      to: '/finance', label: 'Monthly EMI', icon: Wallet, gradient: 'from-amber-500 to-orange-500',
      value: financeQ.data ? formatINR(financeQ.data.totalEMI) : '—',
      sub: financeQ.data?.nextDay ? `Next due: ${financeQ.data.nextDay}` : 'No active loans',
    },
  ];

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <Card className="overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-fuchsia-500/10 pointer-events-none" />
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <Sparkles className="h-6 w-6 text-primary" />
            Welcome back
          </CardTitle>
          <CardDescription className="text-base">{quote}</CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c, i) => (
          <motion.div key={c.to} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Link to={c.to}>
              <Card className="h-full hover:shadow-md hover:-translate-y-0.5 transition-all">
                <CardContent className="p-5">
                  <div className={`inline-flex p-2 rounded-lg bg-gradient-to-br ${c.gradient} text-white mb-3`}>
                    <c.icon className="h-5 w-5" />
                  </div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">{c.label}</p>
                  {learningQ.isLoading || jobsQ.isLoading || tasksQ.isLoading || financeQ.isLoading
                    ? <Skeleton className="h-8 w-24 mt-1" />
                    : <p className="text-2xl font-bold mt-1">{c.value}</p>}
                  <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                    <span>{c.sub}</span>
                    <ArrowRight className="h-3 w-3" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
