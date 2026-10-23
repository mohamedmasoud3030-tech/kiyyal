import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { hasPotentialWebSessionCookie } from '../../../../auth/cookies';
import { CostAdjustmentContent } from '../../../../ui/components/CostAdjustmentContent';
import { ProtectedScreen } from '../../../../ui/components/ProtectedScreen';

export const dynamic = 'force-dynamic';

interface PageProperties {
  readonly params: Promise<{ transactionId: string }>;
}

/** Owner-facing route; API/RLS independently enforce the financial capability. */
export default async function CostAdjustmentPage({ params }: PageProperties) {
  if (!hasPotentialWebSessionCookie((await cookies()).getAll())) redirect('/login');
  const { transactionId } = await params;
  return (
    <ProtectedScreen activePath="/history">
      <CostAdjustmentContent transactionId={transactionId} />
    </ProtectedScreen>
  );
}
