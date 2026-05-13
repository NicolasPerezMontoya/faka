import * as React from 'react';
import { Table, Thead, Tbody, Tr, Th, Td } from './table.js';
import { cn } from '../lib/cn.js';

export interface DataTableColumn<T> {
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  className?: string;
  thClassName?: string;
  width?: string;
}

export interface DataTableProps<T> {
  rows: readonly T[];
  columns: DataTableColumn<T>[];
  emptyState?: React.ReactNode;
  keyFn?: (row: T, idx: number) => string;
  className?: string;
}

export function DataTable<T>({ rows, columns, emptyState, keyFn, className }: DataTableProps<T>): React.JSX.Element {
  return (
    <div className={cn('border border-border rounded-xl bg-card overflow-hidden', className)}>
      <Table>
        <Thead>
          <Tr>
            {columns.map((col, i) => (
              <Th key={i} className={col.thClassName} style={col.width ? { width: col.width } : undefined}>
                {col.header}
              </Th>
            ))}
          </Tr>
        </Thead>
        <Tbody>
          {rows.length === 0 ? (
            <Tr>
              <Td colSpan={columns.length} className="text-center text-muted-foreground py-12">
                {emptyState ?? 'Sin datos'}
              </Td>
            </Tr>
          ) : (
            rows.map((row, i) => (
              <Tr key={keyFn ? keyFn(row, i) : i}>
                {columns.map((col, j) => (
                  <Td key={j} className={col.className}>
                    {col.cell(row)}
                  </Td>
                ))}
              </Tr>
            ))
          )}
        </Tbody>
      </Table>
    </div>
  );
}
