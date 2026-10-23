import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { hasPotentialWebSessionCookie } from '../../../../auth/cookies';
import { ProtectedScreen } from '../../../../ui/components/ProtectedScreen';
import { TransactionReceiptContent } from '../../../../ui/components/TransactionReceiptContent';

export const dynamic = 'force-dynamic';

interface PageProperties {
  readonly params: Promise<{ transactionId: string }>;
}

/** A receipt remains behind the same trusted session and scoped detail boundary. */
export default async function TransactionReceiptPage({ params }: PageProperties) {
  if (!hasPotentialWebSessionCookie((await cookies()).getAll())) redirect('/login');
  const { transactionId } = await params;
  return (
    <ProtectedScreen activePath="/history">
      <TransactionReceiptContent transactionId={transactionId} />
    </ProtectedScreen>
  );
}
