import { useEffect, useState, useCallback } from 'react';
import { Delete, Equal, Divide, X as Times, Minus, Plus, Percent, Dot } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CalculatorProps {
  onUse?: (value: number) => void; // optional callback to push the current display elsewhere
  className?: string;
}

type Op = '+' | '-' | '*' | '/' | null;

export function Calculator({ onUse, className }: CalculatorProps) {
  const [display, setDisplay] = useState('0');
  const [accumulator, setAccumulator] = useState<number | null>(null);
  const [pendingOp, setPendingOp] = useState<Op>(null);
  const [justEvaluated, setJustEvaluated] = useState(false);

  const inputDigit = useCallback((d: string) => {
    setJustEvaluated(false);
    setDisplay((cur) => {
      if (cur === '0' || pendingOp !== null && cur === String(accumulator)) return d;
      if (cur.replace(/[^0-9]/g, '').length >= 14) return cur;
      return cur + d;
    });
  }, [pendingOp, accumulator]);

  const inputDot = useCallback(() => {
    setJustEvaluated(false);
    setDisplay((cur) => (cur.includes('.') ? cur : cur + '.'));
  }, []);

  const clearAll = useCallback(() => {
    setDisplay('0'); setAccumulator(null); setPendingOp(null); setJustEvaluated(false);
  }, []);

  const backspace = useCallback(() => {
    setDisplay((cur) => (cur.length <= 1 || (cur.length === 2 && cur.startsWith('-')) ? '0' : cur.slice(0, -1)));
  }, []);

  const negate = useCallback(() => {
    setDisplay((cur) => (cur === '0' ? cur : cur.startsWith('-') ? cur.slice(1) : '-' + cur));
  }, []);

  const percent = useCallback(() => {
    setDisplay((cur) => formatNumber(parseFloat(cur) / 100));
  }, []);

  const apply = useCallback((op: Op) => {
    const cur = parseFloat(display);
    if (accumulator === null || pendingOp === null) {
      setAccumulator(cur);
    } else if (!justEvaluated) {
      const next = compute(accumulator, cur, pendingOp);
      setAccumulator(next);
      setDisplay(formatNumber(next));
    }
    setPendingOp(op);
    setJustEvaluated(false);
    if (op !== null) {
      // Prepare for next number
      setTimeout(() => setDisplay((d) => d), 0);
    }
  }, [display, accumulator, pendingOp, justEvaluated]);

  const equals = useCallback(() => {
    if (accumulator === null || pendingOp === null) return;
    const cur = parseFloat(display);
    const next = compute(accumulator, cur, pendingOp);
    setDisplay(formatNumber(next));
    setAccumulator(next);
    setPendingOp(null);
    setJustEvaluated(true);
  }, [accumulator, pendingOp, display]);

  // Keyboard support
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const k = e.key;
      if (/^[0-9]$/.test(k)) { e.preventDefault(); inputDigit(k); }
      else if (k === '.') { e.preventDefault(); inputDot(); }
      else if (k === 'Enter' || k === '=') { e.preventDefault(); equals(); }
      else if (k === 'Backspace') { e.preventDefault(); backspace(); }
      else if (k === 'Escape') { e.preventDefault(); clearAll(); }
      else if (k === '+' || k === '-' || k === '*' || k === '/') { e.preventDefault(); apply(k as Op); }
      else if (k === '%') { e.preventDefault(); percent(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inputDigit, inputDot, equals, backspace, clearAll, apply, percent]);

  return (
    <div className={cn('rounded-2xl border bg-card p-4 shadow-sm select-none', className)}>
      {/* Display */}
      <div className="rounded-xl bg-muted/40 px-4 py-5 mb-3 border">
        <div className="text-xs text-muted-foreground h-4 tabular-nums">
          {accumulator !== null && pendingOp !== null && !justEvaluated
            ? `${formatNumber(accumulator)} ${prettyOp(pendingOp)}`
            : ''}
        </div>
        <div
          className="text-right text-3xl sm:text-4xl font-light tabular-nums truncate"
          title={display}
        >{withCommas(display)}</div>
      </div>

      {/* Keypad */}
      <div className="grid grid-cols-4 gap-2">
        <Key tone="muted" onClick={clearAll} label="AC" />
        <Key tone="muted" onClick={negate}><span className="text-base">±</span></Key>
        <Key tone="muted" onClick={percent}><Percent className="h-4 w-4" /></Key>
        <Key tone="op" onClick={() => apply('/')} active={pendingOp === '/'}><Divide className="h-4 w-4" /></Key>

        <Key onClick={() => inputDigit('7')} label="7" />
        <Key onClick={() => inputDigit('8')} label="8" />
        <Key onClick={() => inputDigit('9')} label="9" />
        <Key tone="op" onClick={() => apply('*')} active={pendingOp === '*'}><Times className="h-4 w-4" /></Key>

        <Key onClick={() => inputDigit('4')} label="4" />
        <Key onClick={() => inputDigit('5')} label="5" />
        <Key onClick={() => inputDigit('6')} label="6" />
        <Key tone="op" onClick={() => apply('-')} active={pendingOp === '-'}><Minus className="h-4 w-4" /></Key>

        <Key onClick={() => inputDigit('1')} label="1" />
        <Key onClick={() => inputDigit('2')} label="2" />
        <Key onClick={() => inputDigit('3')} label="3" />
        <Key tone="op" onClick={() => apply('+')} active={pendingOp === '+'}><Plus className="h-4 w-4" /></Key>

        <Key className="col-span-2" onClick={() => inputDigit('0')} label="0" />
        <Key onClick={inputDot}><Dot className="h-4 w-4" /></Key>
        <Key tone="primary" onClick={equals}><Equal className="h-4 w-4" /></Key>
      </div>

      <div className="flex gap-2 mt-3">
        <button
          type="button"
          onClick={backspace}
          className="flex-1 h-9 inline-flex items-center justify-center gap-1.5 rounded-lg text-sm bg-muted/40 hover:bg-muted transition-colors"
        ><Delete className="h-3.5 w-3.5" /> Backspace</button>
        {onUse && (
          <button
            type="button"
            onClick={() => onUse(parseFloat(display) || 0)}
            className="flex-1 h-9 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >Use {withCommas(display)}</button>
        )}
      </div>
    </div>
  );
}

interface KeyProps {
  onClick: () => void;
  label?: string;
  className?: string;
  tone?: 'default' | 'op' | 'primary' | 'muted';
  active?: boolean;
  children?: React.ReactNode;
}

function Key({ onClick, label, className, tone = 'default', active = false, children }: KeyProps) {
  const tones = {
    default: 'bg-card border hover:bg-muted/60',
    muted: 'bg-muted/40 hover:bg-muted',
    op: active
      ? 'bg-primary text-primary-foreground'
      : 'bg-primary/10 text-primary hover:bg-primary/20',
    primary: 'bg-primary text-primary-foreground hover:opacity-90',
  } as const;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-12 rounded-xl text-lg font-medium transition-all active:scale-95 active:translate-y-px',
        'inline-flex items-center justify-center',
        tones[tone],
        className,
      )}
    >{children ?? label}</button>
  );
}

function compute(a: number, b: number, op: Op): number {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b === 0 ? NaN : a / b;
    default: return b;
  }
}

function prettyOp(op: Op): string {
  return op === '*' ? '×' : op === '/' ? '÷' : op ?? '';
}

function formatNumber(n: number): string {
  if (!isFinite(n)) return 'Error';
  if (Number.isInteger(n)) return String(n);
  // Trim to ~10 significant digits, drop trailing zeros
  return Number(n.toPrecision(12)).toString();
}

function withCommas(s: string): string {
  if (s === 'Error') return s;
  const neg = s.startsWith('-');
  const x = neg ? s.slice(1) : s;
  const [intPart, decPart] = x.split('.');
  const grouped = Number(intPart || '0').toLocaleString('en-IN');
  return (neg ? '-' : '') + (decPart !== undefined ? `${grouped}.${decPart}` : grouped);
}
