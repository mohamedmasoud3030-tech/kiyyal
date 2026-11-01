import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { hasPotentialWebSessionCookie } from '../../auth/cookies';
import { ProtectedScreen } from '../../ui/components/ProtectedScreen';
import { UsersContent } from '../../ui/components/UsersContent';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  if (!hasPotentialWebSessionCookie((await cookies()).getAll())) redirect('/login');
  return (
    <ProtectedScreen activePath="/users">
      <UsersContent />
    </ProtectedScreen>
  );
}
