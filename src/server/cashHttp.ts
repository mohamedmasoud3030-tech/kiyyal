import type { AuthContext } from '../auth/context';
import type { Database } from '../db/types';
import { closeCashDay } from '../services/closeCashDay';
import {
  apiJson,
  enforceRateLimit,
  parseInput,
  parseOutput,
  readJson,
  rejectForgedTenantContext,
  requireIdempotencyKey,
  requireMutationProtection,
} from './http';
import { cashDayCloseInputSchema } from './requestSchemas';
import { authenticateRequest } from './requestAuth';
import { cashDayCloseOutputSchema } from './schemas';
import { getRuntimeDatabase } from './runtimeDb';

export interface CashHttpDependencies {
  readonly db?: Database;
  readonly authenticate?: (db: Database, request: Request) => Promise<AuthContext>;
}

/** Protected HTTP boundary for the owner’s daily drawer close. */
export async function postCashDayClose(
  request: Request,
  dependencies: CashHttpDependencies = {},
): Promise<Response> {
  requireMutationProtection(request);
  const idempotencyKey = requireIdempotencyKey(request);
  const raw = await readJson(request);
  const input = parseInput(cashDayCloseInputSchema, raw);
  const db = dependencies.db ?? await getRuntimeDatabase();
  const context = await (dependencies.authenticate ?? authenticateRequest)(db, request);
  await rejectForgedTenantContext(db, context, raw);
  enforceRateLimit(`write:${context.actorId}`, 30, 60 * 1000);

  const result = await closeCashDay(db, context, {
    countedAmount: input.counted_amount,
    idempotencyKey,
    ...(input.note === undefined ? {} : { note: input.note }),
  });
  return apiJson(
    parseOutput(cashDayCloseOutputSchema, {
      id: result.dayCloseId,
      business_date: result.businessDate,
      opening_amount: result.openingAmount,
      expected_amount: result.expectedAmount,
      counted_amount: result.countedAmount,
      difference: result.difference,
      idempotent_replay: result.idempotentReplay,
    }),
    result.idempotentReplay ? 200 : 201,
  );
}
