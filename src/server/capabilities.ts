import type { AuthContext, ActorRole } from '../auth/context';
import { SecurityError } from '../auth/context';

/**
 * The single application-level capability matrix.
 *
 * Route handlers, read-model builders and financial services call
 * `requireCapability`; UI code only receives already-authorized view models.
 * Database RLS remains the second enforcement line.
 */
export const yardCapabilities = [
  'today.view',
  'material.view',
  'material.manage',
  'price.reference.manage',
  'party.view',
  'party.create',
  'party.manage',
  'purchase.create',
  'sale.create',
  'sale.resolve_pending',
  'line.unit_override',
  'price.override',
  'transaction.view_own',
  'history.view_all',
  'transaction.reverse',
  'stock.view',
  'stock.adjust',
  'stock.opening',
  'cost.view',
  'profit.view',
  'cash.view_total',
  'expense.create',
  'payment.create',
  'party.settle',
  'day.close',
  'regrade.create',
  'regrade.resolve',
  'directory.central.browse',
  'directory.report',
  'directory.relation.manage',
  'user.manage',
  'export.data',
  'settings.manage',
  'audit.view',
] as const;

export const platformCapabilities = [
  'directory.central.manage',
  'directory.central.review_reports',
] as const;

// This is intentionally operator-only: an owner sale that exceeds stock is
// rejected, while an operator sale is held for a separate owner resolution.
export const operatorOnlyCapabilities = ['sale.pending_stock_resolution'] as const;

export type Capability = (typeof yardCapabilities)[number]
  | (typeof platformCapabilities)[number]
  | (typeof operatorOnlyCapabilities)[number];

const operatorCapabilities: readonly Capability[] = [
  'today.view',
  'material.view',
  'party.view',
  'party.create',
  'purchase.create',
  'sale.create',
  'sale.pending_stock_resolution',
  'line.unit_override',
  'price.override',
  'transaction.view_own',
  'stock.view',
  'expense.create',
  'payment.create',
];

const matrix: Readonly<Record<ActorRole, readonly Capability[]>> = {
  owner: yardCapabilities,
  operator: operatorCapabilities,
  platform_admin: platformCapabilities,
};

export function hasCapability(context: AuthContext, capability: Capability): boolean {
  return matrix[context.role].includes(capability);
}

export function requireCapability(context: AuthContext, capability: Capability): void {
  if (!hasCapability(context, capability)) {
    throw new SecurityError('unauthorized_capability', 'هذه العملية تحتاج صلاحية المالك');
  }
}
