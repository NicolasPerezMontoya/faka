import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn.js';

const badgeVariants = cva('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', {
  variants: {
    variant: {
      // Sketch palette docs/sketches/csv-upload-wizard.html:21-24
      info: 'bg-indigo-100 text-indigo-800',
      ok: 'bg-emerald-100 text-emerald-800',
      warn: 'bg-amber-100 text-amber-800',
      err: 'bg-rose-100 text-rose-800',
      muted: 'bg-muted text-muted-foreground',
    },
  },
  defaultVariants: { variant: 'muted' },
});

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = ({ className, variant, ...props }: BadgeProps) => (
  <span className={cn(badgeVariants({ variant }), className)} {...props} />
);
Badge.displayName = 'Badge';
