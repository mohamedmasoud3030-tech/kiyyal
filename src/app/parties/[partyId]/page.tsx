import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { hasPotentialWebSessionCookie } from '../../../auth/cookies';
import { PartyLedgerContent } from '../../../ui/components/PartyLedgerContent';
import { ProtectedScreen } from '../../../ui/components/ProtectedScreen';

export const dynamic = 'force-dynamic';

interface PartyLedgerPageProps {
  readonly params: Promise<{ partyId: string }>;
}

export default async function PartyLedgerPage({ params }: PartyLedgerPageProps) {
  if (!hasPotentialWebSessionCookie((await cookies()).getAll())) redirect('/login');
  const { partyId } = await params;
  return (
    <ProtectedScreen activePath="/parties">
      <PartyLedgerContent partyId={partyId} />
    </ProtectedScreen>
  );
}
