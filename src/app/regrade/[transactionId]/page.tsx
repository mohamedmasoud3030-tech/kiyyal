import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { hasPotentialWebSessionCookie } from '../../../auth/cookies';
import { ProtectedScreen } from '../../../ui/components/ProtectedScreen';
import { RegradeDetailContent } from '../../../ui/components/RegradeDetailContent';

export const dynamic = 'force-dynamic';

interface RegradeDetailPageProps {
  readonly params: Promise<{ transactionId: string }>;
}

export default async function RegradeDetailPage({ params }: RegradeDetailPageProps) {
  if (!hasPotentialWebSessionCookie((await cookies()).getAll())) redirect('/login');
  const { transactionId } = await params;
  return (
    <ProtectedScreen activePath="/regrade">
      <RegradeDetailContent transactionId={transactionId} />
    </ProtectedScreen>
  );
}
