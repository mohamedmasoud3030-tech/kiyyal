import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { hasPotentialWebSessionCookie } from '../../auth/cookies';
import { ProtectedScreen } from '../../ui/components/ProtectedScreen';
import { TransactionEntryContent } from '../../ui/components/TransactionEntryContent';

export const dynamic = 'force-dynamic';

export default async function SalePage() {
  if (!hasPotentialWebSessionCookie((await cookies()).getAll())) redirect('/login');
  return (
    <ProtectedScreen activePath="/sale">
      <TransactionEntryContent type="sale" />
    </ProtectedScreen>
  );
}
