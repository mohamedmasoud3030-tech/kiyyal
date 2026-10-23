import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { hasPotentialWebSessionCookie } from '../../auth/cookies';
import { PartiesContent } from '../../ui/components/PartiesContent';
import { ProtectedScreen } from '../../ui/components/ProtectedScreen';

export const dynamic = 'force-dynamic';

export default async function PartiesPage() {
  if (!hasPotentialWebSessionCookie((await cookies()).getAll())) redirect('/login');
  return (
    <ProtectedScreen activePath="/parties">
      <PartiesContent />
    </ProtectedScreen>
  );
}
