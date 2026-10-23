import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { hasPotentialWebSessionCookie } from '../../auth/cookies';
import { PaymentContent } from '../../ui/components/PaymentContent';
import { ProtectedScreen } from '../../ui/components/ProtectedScreen';

export const dynamic = 'force-dynamic';

interface PaymentPageProps {
  readonly searchParams: Promise<{ party?: string | string[] }>;
}

export default async function PaymentPage({ searchParams }: PaymentPageProps) {
  if (!hasPotentialWebSessionCookie((await cookies()).getAll())) redirect('/login');
  const party = (await searchParams).party;
  const initialPartyId = typeof party === 'string' ? party : undefined;
  return (
    <ProtectedScreen activePath="/payment">
      <PaymentContent {...(initialPartyId ? { initialPartyId } : {})} />
    </ProtectedScreen>
  );
}
