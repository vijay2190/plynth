import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Plus, Wallet, TrendingDown, Calendar, Trash2, CheckCircle2 } from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, AreaChart, Area, XAxis, YAxis } from 'recharts';
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
import { calcEMI, monthsBetween, remainingBalance, totalInterest } from '@/lib/emi-math';
import { formatINR } from '@/lib/utils';

const COLORS = ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

export function FinancePage() {
  const { session } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const loansQ = useQuery({
    queryKey: ['loans', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('loans').select('*').eq('user_id', userId!).order('start_date');
      return data ?? [];
    },
  });

  const paymentsQ = useQuery({
    queryKey: ['payments', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('emi_payments').select('*').eq('user_id', userId!);
      return data ?? [];
    },
  });

  const summary = useMemo(() => {
    const loans = loansQ.data ?? [];
    const payments = paymentsQ.data ?? [];
    let totalEMI = 0, totalRemaining = 0, totalInt = 0, maxMonths = 0;
    const breakup: { name: string; value: number }[] = [];
    for (const l of loans) {
      if (l.status !== 'active') continue;
      const paid = payments.filter(p => p.loan_id === l.id && p.status === 'paid').length || monthsBetween(l.start_date);
      const rem = remainingBalance(Number(l.principal_amount), Number(l.interest_rate), l.tenure_months, paid);
      const monthsLeft = Math.max(0, l.tenure_months - paid);
      totalEMI += Number(l.emi_amount);
      totalRemaining += rem;
      totalInt += totalInterest(Number(l.principal_amount), Number(l.emi_amount), l.tenure_months);
      if (monthsLeft > maxMonths) maxMonths = monthsLeft;
      breakup.push({ name: l.name, value: Number(l.emi_amount) });
    }
    return { totalEMI, totalRemaining, totalInt, maxMonths, breakup };
  }, [loansQ.data, paymentsQ.data]);

  const timeline = useMemo(() => {
    const loans = (loansQ.data ?? []).filter(l => l.status === 'active');
    if (!loans.length) return [];
    const points: { month: string; balance: number }[] = [];
    const months = Math.min(60, summary.maxMonths);
    for (let i = 0; i <= months; i += Math.max(1, Math.floor(months / 24))) {
      let bal = 0;
      for (const l of loans) {
        const startPaid = monthsBetween(l.start_date);
        bal += remainingBalance(Number(l.principal_amount), Number(l.interest_rate), l.tenure_months, startPaid + i);
      }
      const d = new Date(); d.setMonth(d.getMonth() + i);
      points.push({ month: d.toLocaleDateString('en', { month: 'short', year: '2-digit' }), balance: Math.round(bal) });
    }
    return points;
  }, [loansQ.data, summary.maxMonths]);

  const payM = useMutation({
    mutationFn: async (loan: any) => {
      const today = new Date();
      const monthYear = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
      const dueDate = new Date(today.getFullYear(), today.getMonth(), loan.emi_due_day).toISOString().slice(0, 10);
      const { error } = await supabase.from('emi_payments').upsert({
        loan_id: loan.id, user_id: userId!, month_year: monthYear, due_date: dueDate,
        amount_paid: loan.emi_amount, paid_date: today.toISOString().slice(0, 10), status: 'paid',
      }, { onConflict: 'loan_id,month_year' });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payments', userId] }); toast.success('Payment recorded'); },
  });

  const delLoanM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('loans').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['loans', userId] }); toast.success('Loan removed'); },
  });

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Finance</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4" /> Add Loan</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add a loan</DialogTitle></DialogHeader>
            <NewLoanForm onCreated={() => { setOpen(false); qc.invalidateQueries({ queryKey: ['loans', userId] }); }} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard icon={Wallet} label="Monthly EMI" value={formatINR(summary.totalEMI)} />
        <SummaryCard icon={TrendingDown} label="Debt Remaining" value={formatINR(summary.totalRemaining)} />
        <SummaryCard icon={Calendar} label="Months to Debt-Free" value={String(summary.maxMonths)} />
        <SummaryCard icon={Wallet} label="Total Interest Payable" value={formatINR(summary.totalInt)} />
      </div>

      {loansQ.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-48" /><Skeleton className="h-48" /></div>
      ) : (loansQ.data ?? []).length === 0 ? (
        <EmptyState icon={Wallet} title="No loans yet" description="Add a loan to start tracking your EMIs and debt timeline." />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {(loansQ.data ?? []).map((l: any) => {
              const paid = (paymentsQ.data ?? []).filter(p => p.loan_id === l.id && p.status === 'paid').length;
              const startMonths = monthsBetween(l.start_date);
              const totalPaid = Math.max(paid, startMonths);
              const rem = remainingBalance(Number(l.principal_amount), Number(l.interest_rate), l.tenure_months, totalPaid);
              const pct = Math.min(100, Math.round((totalPaid / l.tenure_months) * 100));
              const thisMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
              const paidThisMonth = (paymentsQ.data ?? []).some(p => p.loan_id === l.id && p.month_year === thisMonth && p.status === 'paid');
              return (
                <motion.div key={l.id} layout>
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle>{l.name}</CardTitle>
                          <CardDescription>{l.lender || l.loan_type}</CardDescription>
                        </div>
                        <Badge variant={l.status === 'active' ? 'success' : 'secondary'}>{l.status}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div><p className="text-muted-foreground">EMI</p><p className="font-semibold">{formatINR(Number(l.emi_amount))}</p></div>
                        <div><p className="text-muted-foreground">Due day</p><p className="font-semibold">{l.emi_due_day} of month</p></div>
                        <div><p className="text-muted-foreground">Remaining balance</p><p className="font-semibold">{formatINR(rem)}</p></div>
                        <div><p className="text-muted-foreground">Months left</p><p className="font-semibold">{Math.max(0, l.tenure_months - totalPaid)}</p></div>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs text-muted-foreground mb-1"><span>Progress</span><span>{pct}%</span></div>
                        <div className="h-2 bg-secondary rounded-full overflow-hidden">
                          <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} className="h-full bg-primary" />
                        </div>
                      </div>
                      <div className="flex justify-between gap-2">
                        <Button size="sm" variant={paidThisMonth ? 'secondary' : 'default'} disabled={paidThisMonth} onClick={() => payM.mutate(l)}>
                          <CheckCircle2 className="h-4 w-4" /> {paidThisMonth ? 'Paid this month' : 'Mark this month paid'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => delLoanM.mutate(l.id)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Debt timeline</CardTitle><CardDescription>Projected balance over time</CardDescription></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={timeline}>
                    <defs>
                      <linearGradient id="g" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#6366f1" stopOpacity={0.6}/>
                        <stop offset="100%" stopColor="#6366f1" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="month" fontSize={11} />
                    <YAxis fontSize={11} tickFormatter={(v) => `${(v/100000).toFixed(1)}L`} />
                    <Tooltip formatter={(v: number) => formatINR(v)} />
                    <Area dataKey="balance" stroke="#6366f1" fill="url(#g)" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>EMI breakup</CardTitle><CardDescription>By loan</CardDescription></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={summary.breakup} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={2}>
                      {summary.breakup.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => formatINR(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
          </div>
          <Icon className="h-8 w-8 text-muted-foreground/40" />
        </div>
      </CardContent>
    </Card>
  );
}

function NewLoanForm({ onCreated }: { onCreated: () => void }) {
  const { session } = useSession();
  const [f, setF] = useState({
    name: '', lender: '', loan_type: 'home',
    principal_amount: 0, interest_rate: 0, tenure_months: 0,
    start_date: new Date().toISOString().slice(0, 10), emi_due_day: 5,
  });
  const [busy, setBusy] = useState(false);
  const computedEMI = useMemo(() => calcEMI(f.principal_amount, f.interest_rate, f.tenure_months), [f.principal_amount, f.interest_rate, f.tenure_months]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setBusy(true);
    const { error } = await supabase.from('loans').insert({
      user_id: session.user.id,
      name: f.name, lender: f.lender || null, loan_type: f.loan_type,
      principal_amount: f.principal_amount, interest_rate: f.interest_rate,
      emi_amount: Math.round(computedEMI), tenure_months: f.tenure_months,
      start_date: f.start_date, emi_due_day: f.emi_due_day, status: 'active',
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('Loan added'); onCreated();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5 col-span-2"><Label>Name</Label><Input required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Home Loan – HDFC" /></div>
        <div className="space-y-1.5"><Label>Lender</Label><Input value={f.lender} onChange={e => setF({ ...f, lender: e.target.value })} /></div>
        <div className="space-y-1.5">
          <Label>Type</Label>
          <select value={f.loan_type} onChange={e => setF({ ...f, loan_type: e.target.value })} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
            <option value="home">Home</option><option value="car">Car</option><option value="personal">Personal</option>
            <option value="education">Education</option><option value="credit_card">Credit Card</option><option value="other">Other</option>
          </select>
        </div>
        <div className="space-y-1.5"><Label>Principal (₹)</Label><Input type="number" required min={0} value={f.principal_amount || ''} onChange={e => setF({ ...f, principal_amount: Number(e.target.value) })} /></div>
        <div className="space-y-1.5"><Label>Annual interest %</Label><Input type="number" required step="0.01" min={0} value={f.interest_rate || ''} onChange={e => setF({ ...f, interest_rate: Number(e.target.value) })} /></div>
        <div className="space-y-1.5"><Label>Tenure (months)</Label><Input type="number" required min={1} value={f.tenure_months || ''} onChange={e => setF({ ...f, tenure_months: Number(e.target.value) })} /></div>
        <div className="space-y-1.5"><Label>EMI due day (1–28)</Label><Input type="number" min={1} max={28} value={f.emi_due_day} onChange={e => setF({ ...f, emi_due_day: Number(e.target.value) })} /></div>
        <div className="space-y-1.5 col-span-2"><Label>Start date</Label><Input type="date" required value={f.start_date} onChange={e => setF({ ...f, start_date: e.target.value })} /></div>
      </div>
      <div className="rounded-lg bg-muted px-3 py-2 text-sm">
        Calculated EMI: <span className="font-semibold">{formatINR(Math.round(computedEMI))}</span>
      </div>
      <DialogFooter>
        <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add loan'}</Button>
      </DialogFooter>
    </form>
  );
}
