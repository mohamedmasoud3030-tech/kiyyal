import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { hasPotentialWebSessionCookie } from '../../auth/cookies';
import { ProtectedScreen } from '../../ui/components/ProtectedScreen';
import { SetupContent } from '../../ui/components/SetupContent';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  if (!hasPotentialWebSessionCookie((await cookies()).getAll())) redirect('/login');
  return (
    <ProtectedScreen activePath="/settings">
      <SetupContent />
    </ProtectedScreen>
  );
}
