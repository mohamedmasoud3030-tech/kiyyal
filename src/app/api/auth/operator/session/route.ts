import { z } from 'zod';

import { signInOperator, signInOperatorWithCode } from '../../../../../auth/session';
import {
  apiJson,
  enforceRateLimit,
  hashClientIp,
  parseInput,
  parseOutput,
  readJson,
  requireMutationProtection,
  serializeCookie,
  withApi,
} from '../../../../../server/http';
import { operatorSignInInputSchema } from '../../../../../server/requestSchemas';
import { OPERATOR_SESSION_COOKIE } from '../../../../../server/requestAuth';
import { getRuntimeDatabase } from '../../../../../server/runtimeDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sessionOutputSchema = z.object({
  data: z.object({ role: z.literal('operator') }),
});

export async function POST(request: Request): Promise<Response> {
  return withApi(async () => {
    requireMutationProtection(request);
    const input = parseInput(operatorSignInInputSchema, await readJson(request));
    const normalizedName = input.display_name.toLocaleLowerCase('ar-EG');
    const yardLocator = 'operator_login_code' in input ? input.operator_login_code.toUpperCase() : input.yard_id;
    const ipHash = hashClientIp(request);
    // Account-level persistence/lockout is enforced by Postgres; these bounded
    // process windows additionally absorb bursts before Argon2id work begins.
    enforceRateLimit(`operator:${yardLocator}:${normalizedName}`, 5, 15 * 60 * 1000);
    if (ipHash) enforceRateLimit(`operator-ip:${ipHash}`, 20, 15 * 60 * 1000);

    const db = await getRuntimeDatabase();
    const metadata = {
      ...(request.headers.get('user-agent') ? { userAgent: request.headers.get('user-agent')! } : {}),
      ...(ipHash ? { ipHash } : {}),
    };
    const result = 'operator_login_code' in input
      ? await signInOperatorWithCode(db, input.operator_login_code, input.display_name, input.pin, metadata)
      : await signInOperator(db, input.yard_id, input.display_name, input.pin, metadata);
    return apiJson(
      parseOutput(sessionOutputSchema, { data: { role: 'operator' } }),
      201,
      {
        'set-cookie': serializeCookie(OPERATOR_SESSION_COOKIE, result.token, {
          httpOnly: true,
          maxAge: 12 * 60 * 60,
        }),
      },
    );
  });
}
