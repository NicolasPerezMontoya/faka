// MappingTable — design from docs/sketches/csv-upload-wizard.html:212-256

'use client';

import * as React from 'react';
import { Select } from './select.js';
import { Badge } from './badge.js';
import { cn } from '../lib/cn.js';

export interface MappingRow {
  field: string;
  required?: boolean;
  sourceColumn: string | null;
  confidence?: 'high' | 'mid' | 'none';
  hint?: string;
}

export interface MappingTableProps {
  rows: MappingRow[];
  availableSourceColumns: string[];
  onChange: (rowIdx: number, sourceColumn: string | null) => void;
  className?: string;
}

const CONFIDENCE_BADGE: Record<'high' | 'mid' | 'none', { variant: 'ok' | 'warn' | 'muted'; label: string }> = {
  high: { variant: 'ok', label: 'auto' },
  mid: { variant: 'warn', label: 'manual' },
  none: { variant: 'muted', label: 'opcional' },
};

export function MappingTable({
  rows,
  availableSourceColumns,
  onChange,
  className,
}: MappingTableProps): React.JSX.Element {
  return (
    <div className={cn('border border-border rounded-lg divide-y divide-border bg-card', className)}>
      {rows.map((row, i) => {
        const conf = row.confidence ?? 'none';
        const badge = CONFIDENCE_BADGE[conf];
        const overrideBadge = row.hint ? { variant: 'warn' as const, label: row.hint } : badge;
        return (
          <div key={i} className="grid grid-cols-12 gap-3 px-3 py-3 items-center text-sm">
            <div className="col-span-4 font-medium">
              {row.field}
              {row.required && <span className="text-destructive"> *</span>}
            </div>
            <div className="col-span-1 text-muted-foreground" aria-hidden>
              ←
            </div>
            <div className="col-span-5">
              <Select
                value={row.sourceColumn ?? ''}
                onChange={(e) => onChange(i, e.target.value === '' ? null : e.target.value)}
              >
                <option value="">— sin mapear —</option>
                {availableSourceColumns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </Select>
            </div>
            <div className="col-span-2">
              <Badge variant={overrideBadge.variant}>{overrideBadge.label}</Badge>
            </div>
          </div>
        );
      })}
    </div>
  );
}
