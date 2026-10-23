import type { AuthContext } from '../auth/context';
import type { Database } from '../db/types';
import { postPayment } from '../services/postPayment';
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
import { paymentInputSchema } from './requestSchemas';
import { authenticateRequest } from './requestAuth';
import { paymentOutputSchema } from './schemas';
import { getRuntimeDatabase } from './runtimeDb';

export interface PaymentHttpDependencies {
  readonly db?: Database;
  readonly authenticate?: (db: Database, request: Request) => Promise<AuthContext>;
}

/** Protected, role-scoped HTTP boundary for one party settlement/advance. */
export async function postPaymentTransaction(
  request: Request,
  dependencies: PaymentHttpDependencies = {},
): Promise<Response> {
  requireMutationProtection(request);
  const idempotencyKey = requireIdempotencyKey(request);
  const raw = await readJson(request);
  const input = parseInput(paymentInputSchema, raw);
  const db = dependencies.db ?? await getRuntimeDatabase();
  const context = await (dependencies.authenticate ?? authenticateRequest)(db, request);
  await rejectForgedTenantContext(db, context, raw);
  enforceRateLimit(`write:${context.actorId}`, 30, 60 * 1000);

  const result = await postPayment(db, context, {
    partyId: input.party_id,
    direction: input.direction,
    amount: input.amount,
    idempotencyKey,
    ...(input.note === undefined ? {} : { note: input.note }),
    ...(input.confirm_duplicate === undefined ? {} : { confirmDuplicate: input.confirm_duplicate }),
  });
  return apiJson(
    parseOutput(paymentOutputSchema, {
      id: result.transactionId,
      number: result.number,
      business_date: result.businessDate,
      direction: result.direction,
      amount: result.amount,
      idempotent_replay: result.idempotentReplay,
    }),
    result.idempotentReplay ? 200 : 201,
  );
}
