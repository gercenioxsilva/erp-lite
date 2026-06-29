import type { ReactNode } from 'react';

export type BadgeVariant =
  | 'product' | 'service' | 'asset' | 'raw_material'
  | 'active' | 'inactive' | 'draft' | 'issued' | 'cancelled'
  | 'confirmed' | 'pending' | 'paid' | 'overdue' | 'low';

export function Badge({ variant, children }: { variant: BadgeVariant; children: ReactNode }) {
  return <span className={`badge badge-${variant}`}>{children}</span>;
}
