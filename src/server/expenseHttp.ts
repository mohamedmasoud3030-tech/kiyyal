import type { AuthContext } from '../auth/context';
import type { Database } from '../db/types';
import { postExpense } from '../services/postExpense';
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
import { expenseInputSchema } from './requestSchemas';
import { authenticateRequest } from './requestAuth';
import { expenseOutputSchema } from './schemas';
import { getRuntimeDatabase } from './runtimeDb';

export interface ExpenseHttpDependencies {
  readonly db?: Database;
  readonly authenticate?: (db: Database, request: Request) => Promise<AuthContext>;
}

/** Protected boundary for an owner/operator operational cash expense. */
export async function postExpenseTransaction(
  request: Request,
  dependencies: ExpenseHttpDependencies = {},
): Promise<Response> {
  requireMutationProtection(request);
  const idempotencyKey = requireIdempotencyKey(request);
  const raw = await readJson(request);
  const input = parseInput(expenseInputSchema, raw);
  const db = dependencies.db ?? await getRuntimeDatabase();
  const context = await (dependencies.authenticate ?? authenticateRequest)(db, request);
  await rejectForgedTenantContext(db, context, raw);
  enforceRateLimit(`write:${context.actorId}`, 30, 60 * 1000);

  const result = await postExpense(db, context, {
    category: input.category,
    amount: input.amount,
    idempotencyKey,
    ...(input.note === undefined ? {} : { note: input.note }),
  });
  return apiJson(
    parseOutput(expenseOutputSchema, {
      id: result.transactionId,
      number: result.number,
      business_date: result.businessDate,
      category: result.category,
      amount: result.amount,
      idempotent_replay: result.idempotentReplay,
    }),
    result.idempotentReplay ? 200 : 201,
  );
}
