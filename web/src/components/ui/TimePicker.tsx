import { useState } from 'react';
import { Clock } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/Popover';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface TimePickerProps {
  value: string; // "HH:MM:SS" or "HH:MM"
  onChange: (next: string) => void; // "HH:MM:SS"
  disabled?: boolean;
  className?: string;
}

const HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5); // 0,5,...,55

export function TimePicker({ value, onChange, disabled, className }: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const [h24, m] = parse(value);
  const isPm = h24 >= 12;
  const h12 = ((h24 + 11) % 12) + 1;

  function commit(nextH12: number, nextM: number, nextPm: boolean) {
    let h = nextH12 % 12;
    if (nextPm) h += 12;
    onChange(`${pad(h)}:${pad(nextM)}:00`);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn('h-8 px-3 gap-1.5 font-mono tabular-nums', className)}
        >
          <Clock className="h-3.5 w-3.5 opacity-60" />
          {format12(h24, m)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-3" align="start">
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Hour</div>
          <div className="grid grid-cols-6 gap-1">
            {HOURS_12.map((hh) => (
              <button
                key={hh}
                type="button"
                onClick={() => commit(hh, m, isPm)}
                className={cn(
                  'h-8 rounded text-sm tabular-nums',
                  hh === h12 ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                )}
              >{hh}</button>
            ))}
          </div>
          <div className="text-xs font-medium text-muted-foreground pt-1">Minute</div>
          <div className="grid grid-cols-6 gap-1">
            {MINUTES.map((mm) => (
              <button
                key={mm}
                type="button"
                onClick={() => commit(h12, mm, isPm)}
                className={cn(
                  'h-8 rounded text-sm tabular-nums',
                  mm === m ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                )}
              >{pad(mm)}</button>
            ))}
          </div>
          <div className="flex gap-1 pt-1">
            <button
              type="button"
              onClick={() => commit(h12, m, false)}
              className={cn(
                'flex-1 h-8 rounded text-sm font-medium',
                !isPm ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
              )}
            >AM</button>
            <button
              type="button"
              onClick={() => commit(h12, m, true)}
              className={cn(
                'flex-1 h-8 rounded text-sm font-medium',
                isPm ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
              )}
            >PM</button>
          </div>
          <Button size="sm" className="w-full mt-1" onClick={() => setOpen(false)}>Done</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function parse(v: string): [number, number] {
  const [h = '0', m = '0'] = (v ?? '00:00').split(':');
  return [Number(h) || 0, Number(m) || 0];
}
function pad(n: number): string { return n.toString().padStart(2, '0'); }
function format12(h24: number, m: number): string {
  const isPm = h24 >= 12;
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12}:${pad(m)} ${isPm ? 'PM' : 'AM'}`;
}
