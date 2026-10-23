import type { AuthContext } from '../auth/context';
import type { Database } from '../db/types';
import type { PostTransactionInput, PostResult } from '../services/postTransaction';
import { postTransaction } from '../services/postTransaction';
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
import { postTransactionInputSchema } from './requestSchemas';
import { authenticateRequest } from './requestAuth';
import { postedTransactionOperatorOutputSchema, postedTransactionOwnerOutputSchema } from './schemas';
import { getRuntimeDatabase } from './runtimeDb';

type LedgerTransactionType = 'purchase' | 'sale';

function toPostInput(
  type: LedgerTransactionType,
  idempotencyKey: string,
  input: ReturnType<typeof postTransactionInputSchema.parse>,
): PostTransactionInput {
  return {
    type,
    businessDate: input.business_date,
    lines: input.lines.map((line) => ({
      materialId: line.material_id,
      grossKg: line.gross_kg,
      deductionType: line.deduction_type,
      deductionValue: line.deduction_value,
      unitPrice: line.unit_price,
      priceUnit: line.price_unit,
    })),
    amountCash: input.amount_cash,
    idempotencyKey,
    ...(input.party_id === undefined ? {} : { partyId: input.party_id }),
    ...(input.note === undefined ? {} : { note: input.note }),
    ...(input.device_created_at === undefined ? {} : { deviceCreatedAt: input.device_created_at }),
  };
}

function resultForOperator(result: PostResult) {
  return {
    id: result.transactionId,
    number: result.number,
    status: result.status,
    total_amount: result.totalAmount,
    balance_amount: result.balanceAmount,
    lines: result.lines.map((line) => ({
      material_id: line.materialId,
      net_kg: line.netKg,
      price_per_kg: line.pricePerKg,
      line_total: line.lineTotal,
    })),
    idempotent_replay: result.idempotentReplay,
  };
}

function resultForOwner(result: PostResult) {
  return {
    ...resultForOperator(result),
    lines: result.lines.map((line) => ({
      material_id: line.materialId,
      net_kg: line.netKg,
      price_per_kg: line.pricePerKg,
      line_total: line.lineTotal,
      cost_snapshot_per_kg: line.costSnapshotPerKg,
      gross_profit: line.grossProfit,
    })),
  };
}

export interface LedgerHttpDependencies {
  readonly db?: Database;
  readonly authenticate?: (db: Database, request: Request) => Promise<AuthContext>;
}

/** Shared protected boundary for the only currently implemented ledger mutations. */
export async function postLedgerTransaction(
  request: Request,
  type: LedgerTransactionType,
  dependencies: LedgerHttpDependencies = {},
): Promise<Response> {
  requireMutationProtection(request);
  const idempotencyKey = requireIdempotencyKey(request);
  const raw = await readJson(request);
  const parsed = parseInput(postTransactionInputSchema, raw);
  const db = dependencies.db ?? await getRuntimeDatabase();
  const context = await (dependencies.authenticate ?? authenticateRequest)(db, request);
  await rejectForgedTenantContext(db, context, raw);
  enforceRateLimit(`write:${context.actorId}`, 60, 60 * 1000);

  const result = await postTransaction(db, context, toPostInput(type, idempotencyKey, parsed));
  if (context.role === 'owner') {
    return apiJson(
      parseOutput(postedTransactionOwnerOutputSchema, resultForOwner(result)),
      result.idempotentReplay ? 200 : 201,
    );
  }
  return apiJson(
    parseOutput(postedTransactionOperatorOutputSchema, resultForOperator(result)),
    result.idempotentReplay ? 200 : 201,
  );
}
