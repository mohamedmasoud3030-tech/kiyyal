import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { hasPotentialWebSessionCookie } from '../../../auth/cookies';
import { ProtectedScreen } from '../../../ui/components/ProtectedScreen';
import { TransactionDetailContent } from '../../../ui/components/TransactionDetailContent';

export const dynamic = 'force-dynamic';

interface PageProperties {
  readonly params: Promise<{ transactionId: string }>;
}

export default async function TransactionDetailPage({ params }: PageProperties) {
  if (!hasPotentialWebSessionCookie((await cookies()).getAll())) redirect('/login');
  const { transactionId } = await params;
  return (
    <ProtectedScreen activePath="/history">
      <TransactionDetailContent transactionId={transactionId} />
    </ProtectedScreen>
  );
}
