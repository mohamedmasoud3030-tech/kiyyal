import type { Queryable } from '../db/types';
import { DomainError } from '../domain/line';

/**
 * Serializes the application’s financial mutations per yard. A close obtains the
 * same row lock as posting, so it cannot snapshot the drawer while a write is
 * half-complete, and a later write observes the newly closed day trigger.
 */
export async function lockFinancialYard(tx: Queryable, yardId: string): Promise<void> {
  const result = await tx.query<{ id: string }>(`SELECT id FROM app.yards WHERE id = $1 FOR UPDATE`, [yardId]);
  if (!result.rows[0]) throw new DomainError('validation_failed', 'الساحة غير متاحة');
}
