import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { hasPotentialWebSessionCookie } from '../../auth/cookies';
import { ProtectedScreen } from '../../ui/components/ProtectedScreen';
import { RegradeContent } from '../../ui/components/RegradeContent';

export const dynamic = 'force-dynamic';

export default async function RegradePage() {
  if (!hasPotentialWebSessionCookie((await cookies()).getAll())) redirect('/login');
  return (
    <ProtectedScreen activePath="/regrade">
      <RegradeContent />
    </ProtectedScreen>
  );
}
