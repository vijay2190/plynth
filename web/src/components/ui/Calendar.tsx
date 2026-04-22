import * as React from 'react';
import { DayPicker, type DayPickerProps } from 'react-day-picker';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import 'react-day-picker/dist/style.css';

export type CalendarProps = DayPickerProps;

export function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row gap-4',
        month: 'space-y-3',
        month_caption: 'flex justify-center pt-1 relative items-center',
        caption_label: 'text-sm font-semibold',
        nav: 'flex items-center justify-between absolute inset-x-1 top-1',
        button_previous:
          'inline-flex h-7 w-7 items-center justify-center rounded-md border border-input bg-transparent hover:bg-accent hover:text-accent-foreground transition-colors',
        button_next:
          'inline-flex h-7 w-7 items-center justify-center rounded-md border border-input bg-transparent hover:bg-accent hover:text-accent-foreground transition-colors',
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'text-muted-foreground rounded-md w-9 font-normal text-[0.75rem]',
        week: 'flex w-full mt-1',
        day: 'h-9 w-9 text-center text-sm p-0 relative',
        day_button:
          'inline-flex h-9 w-9 items-center justify-center rounded-md text-sm font-normal hover:bg-accent hover:text-accent-foreground transition-colors',
        selected:
          '[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground',
        today: '[&>button]:ring-1 [&>button]:ring-ring',
        outside: '[&>button]:text-muted-foreground/40',
        disabled: '[&>button]:text-muted-foreground/30 [&>button]:cursor-not-allowed',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === 'left' ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />,
      }}
      {...props}
    />
  );
}
