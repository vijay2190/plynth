import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Loader({ fullscreen, label, className }: { fullscreen?: boolean; label?: string; className?: string }) {
  const inner = (
    <div className={cn('flex flex-col items-center gap-3 text-muted-foreground', className)}>
      <Loader2 className="h-6 w-6 animate-spin" />
      {label && <p className="text-sm">{label}</p>}
    </div>
  );
  if (fullscreen) return <div className="min-h-screen grid place-items-center">{inner}</div>;
  return inner;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />;
}
