// Stepper component — design from docs/sketches/csv-upload-wizard.html:71-86

import * as React from 'react';
import { cn } from '../lib/cn.js';

export interface StepperStep {
  label: string;
  href?: string;
}

export interface StepperProps {
  steps: StepperStep[];
  /** 1-indexed active step. Steps before are marked 'done'; after are 'upcoming'. */
  active: number;
  className?: string;
}

export function Stepper({ steps, active, className }: StepperProps): React.JSX.Element {
  return (
    <ol className={cn('flex items-center gap-3 text-sm', className)}>
      {steps.map((step, i) => {
        const num = i + 1;
        const state: 'done' | 'active' | 'upcoming' =
          num < active ? 'done' : num === active ? 'active' : 'upcoming';
        return (
          <React.Fragment key={i}>
            <li className="flex items-center gap-2">
              <span
                className={cn(
                  'w-7 h-7 rounded-full grid place-items-center text-xs font-bold transition-colors',
                  state === 'done' && 'bg-emerald-600 text-white',
                  state === 'active' && 'bg-primary text-primary-foreground',
                  state === 'upcoming' && 'bg-muted text-muted-foreground',
                )}
              >
                {state === 'done' ? '✓' : num}
              </span>
              <span
                className={cn(
                  state === 'active' ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                {step.label}
              </span>
            </li>
            {i < steps.length - 1 && (
              <li aria-hidden className="text-muted-foreground/40">
                ───────
              </li>
            )}
          </React.Fragment>
        );
      })}
    </ol>
  );
}
