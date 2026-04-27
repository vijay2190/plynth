import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Wallet, TrendingDown, Calendar, Trash2, CheckCircle2,
  ChevronLeft, ChevronRight, Repeat, Calculator as CalcIcon, Pencil, X,
} from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, AreaChart, Area, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose,
} from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Loader';
import { Switch } from '@/components/ui/Switch';
import { Calculator } from '@/components/Calculator';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/useSession';
import { calcEMI, monthsBetween, remainingBalance, totalInterest } from '@/lib/emi-math';
import { formatINR, cn } from '@/lib/utils';

const COLORS = ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
const CATEGORIES = ['housing', 'food', 'transport', 'utilities', 'entertainment', 'health', 'shopping', 'other'] as const;

function ymString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function ymLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en', { month: 'long', year: 'numeric' });
}
function shiftYm(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return ymString(d);
}

export function FinancePage() {
  const { session } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();

  const [ym, setYm] = useState<string>(ymString(new Date()));
  const [calcOpen, setCalcOpen] = useState(false);
  const [openLoan, setOpenLoan] = useState(false);

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

  const budgetQ = useQuery({
    queryKey: ['budget_month', userId, ym],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('budget_months').select('*').eq('user_id', userId!).eq('year_month', ym).maybeSingle();
      return data;
    },
  });

  const monthlyExpQ = useQuery({
    queryKey: ['monthly_expenses', userId, ym],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('monthly_expenses').select('*').eq('user_id', userId!).eq('year_month', ym).order('created_at');
      return data ?? [];
    },
  });

  const recurringQ = useQuery({
    queryKey: ['recurring_expenses', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('recurring_expenses').select('*').eq('user_id', userId!).order('created_at');
      return data ?? [];
    },
  });

  const monthEmis = useMemo(() => (loansQ.data ?? []).filter((l: any) => l.status === 'active'), [loansQ.data]);

  const totals = useMemo(() => {
    const recurring = (recurringQ.data ?? []).filter((r: any) => r.active).reduce((s: number, r: any) => s + Number(r.amount), 0);
    const oneOff = (monthlyExpQ.data ?? []).filter((e: any) => !e.recurring_id).reduce((s: number, e: any) => s + Number(e.amount), 0);
    const emi = monthEmis.reduce((s: number, l: any) => s + Number(l.emi_amount), 0);
    const planned = recurring + oneOff + emi;
    const total = Number(budgetQ.data?.total_budget ?? 0);
    return { recurring, oneOff, emi, planned, total, balance: total - planned };
  }, [recurringQ.data, monthlyExpQ.data, monthEmis, budgetQ.data]);

  const breakup = useMemo(() => {
    const list: { name: string; value: number }[] = [];
    if (totals.emi) list.push({ name: 'EMIs', value: totals.emi });
    if (totals.recurring) list.push({ name: 'Recurring', value: totals.recurring });
    if (totals.oneOff) list.push({ name: 'This month', value: totals.oneOff });
    if (totals.balance > 0) list.push({ name: 'Balance', value: totals.balance });
    return list;
  }, [totals]);

  const setBudgetM = useMutation({
    mutationFn: async (amount: number) => {
      const { error } = await supabase.from('budget_months').upsert(
        { user_id: userId!, year_month: ym, total_budget: amount },
        { onConflict: 'user_id,year_month' },
      );
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['budget_month', userId, ym] }); toast.success('Budget saved'); },
    onError: (e) => toast.error((e as Error).message),
  });

  const addExpenseM = useMutation({
    mutationFn: async (input: { name: string; amount: number; category: string }) => {
      const { error } = await supabase.from('monthly_expenses').insert({ user_id: userId!, year_month: ym, ...input });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['monthly_expenses', userId, ym] }); toast.success('Expense added'); },
    onError: (e) => toast.error((e as Error).message),
  });

  const updateExpenseM = useMutation({
    mutationFn: async (patch: any) => {
      const { id, ...fields } = patch;
      const { error } = await supabase.from('monthly_expenses').update(fields).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monthly_expenses', userId, ym] }),
    onError: (e) => toast.error((e as Error).message),
  });

  const delExpenseM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('monthly_expenses').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monthly_expenses', userId, ym] }),
  });

  const addRecurringM = useMutation({
    mutationFn: async (input: { name: string; amount: number; category: string }) => {
      const { error } = await supabase.from('recurring_expenses').insert({ user_id: userId!, ...input });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recurring_expenses', userId] }); toast.success('Recurring added'); },
    onError: (e) => toast.error((e as Error).message),
  });

  const updateRecurringM = useMutation({
    mutationFn: async (patch: any) => {
      const { id, ...fields } = patch;
      const { error } = await supabase.from('recurring_expenses').update(fields).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring_expenses', userId] }),
  });

  const delRecurringM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('recurring_expenses').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring_expenses', userId] }),
  });

  const summary = useMemo(() => {
    const loans = loansQ.data ?? [];
    const payments = paymentsQ.data ?? [];
    let totalEMI = 0, totalRemaining = 0, totalInt = 0, maxMonths = 0;
    const breakupL: { name: string; value: number }[] = [];
    for (const l of loans) {
      if (l.status !== 'active') continue;
      const paid = payments.filter((p: any) => p.loan_id === l.id && p.status === 'paid').length || monthsBetween(l.start_date);
      const rem = remainingBalance(Number(l.principal_amount), Number(l.interest_rate), l.tenure_months, paid);
      const monthsLeft = Math.max(0, l.tenure_months - paid);
      totalEMI += Number(l.emi_amount);
      totalRemaining += rem;
      totalInt += totalInterest(Number(l.principal_amount), Number(l.emi_amount), l.tenure_months);
      if (monthsLeft > maxMonths) maxMonths = monthsLeft;
      breakupL.push({ name: l.name, value: Number(l.emi_amount) });
    }
    return { totalEMI, totalRemaining, totalInt, maxMonths, breakup: breakupL };
  }, [loansQ.data, paymentsQ.data]);

  const timeline = useMemo(() => {
    const loans = (loansQ.data ?? []).filter((l: any) => l.status === 'active');
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
      const monthYear = ymString(today);
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

  const isCurrentMonth = ym === ymString(new Date());

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Finance</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setCalcOpen(true)}><CalcIcon className="h-4 w-4" /> Calculator</Button>
          <Dialog open={openLoan} onOpenChange={setOpenLoan}>
            <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4" /> Add Loan</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add a loan</DialogTitle></DialogHeader>
              <NewLoanForm onCreated={() => { setOpenLoan(false); qc.invalidateQueries({ queryKey: ['loans', userId] }); }} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Month navigator + budget */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" onClick={() => setYm(shiftYm(ym, -1))} title="Previous month"><ChevronLeft className="h-4 w-4" /></Button>
              <div className="min-w-[180px] text-center">
                <div className="text-lg font-semibold">{ymLabel(ym)}</div>
                {!isCurrentMonth && (
                  <button className="text-xs text-primary hover:underline" onClick={() => setYm(ymString(new Date()))}>Jump to current</button>
                )}
              </div>
              <Button size="icon" variant="ghost" onClick={() => setYm(shiftYm(ym, 1))} title="Next month"><ChevronRight className="h-4 w-4" /></Button>
            </div>
            <BudgetEditor value={Number(budgetQ.data?.total_budget ?? 0)} onSave={(v) => setBudgetM.mutate(v)} loading={budgetQ.isLoading} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-4">
            <BudgetTile label="Total budget" value={totals.total} accent="primary" />
            <BudgetTile
              label="Planned"
              value={totals.planned}
              accent="amber"
              sub={`EMIs ${formatINR(totals.emi)} · Recurring ${formatINR(totals.recurring)} · Other ${formatINR(totals.oneOff)}`}
            />
            <BudgetTile label="Balance" value={totals.balance} accent={totals.balance >= 0 ? 'green' : 'red'} />
            <div className="rounded-xl border p-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Allocation</div>
              <div className="h-[88px]">
                {breakup.length ? (
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={breakup} dataKey="value" nameKey="name" innerRadius={24} outerRadius={42} paddingAngle={2}>
                        {breakup.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => formatINR(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <div className="h-full flex items-center justify-center text-xs text-muted-foreground">No data</div>}
              </div>
            </div>
          </div>

          {totals.total > 0 && (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>Used</span>
                <span>{Math.round(Math.min(100, (totals.planned / totals.total) * 100))}%</span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, (totals.planned / totals.total) * 100)}%` }}
                  className={cn('h-full', totals.balance < 0 ? 'bg-red-500' : 'bg-primary')}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Expenses lists */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Wallet className="h-4 w-4" /> Expenses for {ymLabel(ym)}</CardTitle>
            <CardDescription>One-off items planned this month.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ExpenseAddForm onAdd={(p) => addExpenseM.mutate(p)} onOpenCalc={() => setCalcOpen(true)} />
            <div className="space-y-2">
              {monthlyExpQ.isLoading ? <Skeleton className="h-16" /> :
                (monthlyExpQ.data ?? []).filter((e: any) => !e.recurring_id).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No expenses yet.</p>
                ) : (
                  <AnimatePresence initial={false}>
                    {(monthlyExpQ.data ?? []).filter((e: any) => !e.recurring_id).map((e: any) => (
                      <motion.div key={e.id} layout initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        className="flex items-center justify-between p-2.5 rounded-lg border gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Switch checked={!!e.paid} onCheckedChange={(v) => updateExpenseM.mutate({ id: e.id, paid: v })} />
                          <div className="min-w-0">
                            <p className={cn('text-sm font-medium truncate', e.paid && 'line-through text-muted-foreground')}>{e.name}</p>
                            <Badge variant="outline" className="text-[10px]">{e.category}</Badge>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold tabular-nums">{formatINR(Number(e.amount))}</span>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => delExpenseM.mutate(e.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                )
              }
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Repeat className="h-4 w-4" /> Recurring (every month)</CardTitle>
            <CardDescription>Mobile, WiFi, subscriptions — applied to every month automatically.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ExpenseAddForm placeholder="e.g. WiFi" onAdd={(p) => addRecurringM.mutate(p)} onOpenCalc={() => setCalcOpen(true)} />
            <div className="space-y-2">
              {recurringQ.isLoading ? <Skeleton className="h-16" /> :
                (recurringQ.data ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No recurring expenses yet.</p>
                ) : (
                  <AnimatePresence initial={false}>
                    {(recurringQ.data ?? []).map((r: any) => (
                      <motion.div key={r.id} layout initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        className={cn('flex items-center justify-between p-2.5 rounded-lg border gap-2 transition-opacity', !r.active && 'opacity-50')}>
                        <div className="flex items-center gap-2 min-w-0">
                          <Switch checked={!!r.active} onCheckedChange={(v) => updateRecurringM.mutate({ id: r.id, active: v })} />
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{r.name}</p>
                            <Badge variant="outline" className="text-[10px]">{r.category}</Badge>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold tabular-nums">{formatINR(Number(r.amount))}</span>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => delRecurringM.mutate(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                )
              }
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Loans */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Loans &amp; EMIs</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-4">
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
                const paid = (paymentsQ.data ?? []).filter((p: any) => p.loan_id === l.id && p.status === 'paid').length;
                const startMonths = monthsBetween(l.start_date);
                const totalPaid = Math.max(paid, startMonths);
                const rem = remainingBalance(Number(l.principal_amount), Number(l.interest_rate), l.tenure_months, totalPaid);
                const pct = Math.min(100, Math.round((totalPaid / l.tenure_months) * 100));
                const thisMonth = ymString(new Date());
                const paidThisMonth = (paymentsQ.data ?? []).some((p: any) => p.loan_id === l.id && p.month_year === thisMonth && p.status === 'paid');
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

            <div className="grid gap-4 lg:grid-cols-2 mt-4">
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

      {/* Calculator dialog */}
      <Dialog open={calcOpen} onOpenChange={setCalcOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Calculator</DialogTitle></DialogHeader>
          <Calculator />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BudgetTile({ label, value, accent, sub }: { label: string; value: number; accent: 'primary' | 'amber' | 'green' | 'red'; sub?: string }) {
  const tones: Record<string, string> = {
    primary: 'border-primary/30',
    amber: 'border-amber-500/30',
    green: 'border-emerald-500/30',
    red: 'border-red-500/40 bg-red-500/5',
  };
  const text: Record<string, string> = {
    primary: 'text-primary',
    amber: 'text-amber-600 dark:text-amber-400',
    green: 'text-emerald-600 dark:text-emerald-400',
    red: 'text-red-600 dark:text-red-400',
  };
  return (
    <div className={cn('rounded-xl border p-3', tones[accent])}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('text-xl font-bold mt-1 tabular-nums', text[accent])}>{formatINR(value)}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-1 truncate" title={sub}>{sub}</div>}
    </div>
  );
}

function BudgetEditor({ value, onSave, loading }: { value: number; onSave: (v: number) => void; loading: boolean }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(String(value || ''));
  return editing ? (
    <div className="flex items-center gap-2">
      <Label className="text-xs whitespace-nowrap">Total budget ₹</Label>
      <Input type="number" min={0} value={v} onChange={(e) => setV(e.target.value)} autoFocus className="h-9 w-32" />
      <Button size="sm" onClick={() => { onSave(Number(v) || 0); setEditing(false); }}>Save</Button>
      <Button size="sm" variant="ghost" onClick={() => { setV(String(value || '')); setEditing(false); }}><X className="h-4 w-4" /></Button>
    </div>
  ) : (
    <Button size="sm" variant="outline" onClick={() => { setV(String(value || '')); setEditing(true); }} disabled={loading}>
      <Pencil className="h-3.5 w-3.5" /> {value ? `Edit budget (${formatINR(value)})` : 'Set monthly budget'}
    </Button>
  );
}

function ExpenseAddForm({ onAdd, placeholder, onOpenCalc }: { onAdd: (p: { name: string; amount: number; category: string }) => void; placeholder?: string; onOpenCalc?: () => void }) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<string>('other');
  return (
    <form
      className="grid grid-cols-12 gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const a = Number(amount);
        if (!name.trim() || !a || a < 0) return;
        onAdd({ name: name.trim(), amount: a, category });
        setName(''); setAmount(''); setCategory('other');
      }}
    >
      <Input className="col-span-5" placeholder={placeholder ?? 'Item name'} value={name} onChange={(e) => setName(e.target.value)} />
      <div className="col-span-3 flex">
        <Input type="number" min={0} step="0.01" placeholder="₹" value={amount} onChange={(e) => setAmount(e.target.value)} className="rounded-r-none" />
        {onOpenCalc && (
          <button type="button" onClick={onOpenCalc} title="Open calculator" className="h-10 px-2 border border-l-0 rounded-r-lg bg-muted/40 hover:bg-muted">
            <CalcIcon className="h-4 w-4" />
          </button>
        )}
      </div>
      <select value={category} onChange={(e) => setCategory(e.target.value)} className="col-span-3 h-10 rounded-lg border border-input bg-background px-2 text-sm">
        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <Button size="sm" type="submit" className="col-span-1 h-10"><Plus className="h-4 w-4" /></Button>
    </form>
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
