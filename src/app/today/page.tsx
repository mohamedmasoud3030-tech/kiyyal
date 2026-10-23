import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { ProtectedScreen } from '../../ui/components/ProtectedScreen';
import { TodayContent } from '../../ui/components/TodayContent';
import { hasPotentialWebSessionCookie } from '../../auth/cookies';

export const dynamic = 'force-dynamic';

export default async function TodayPage() {
  // This only avoids rendering a protected app shell for an anonymous visitor;
  // the client still validates the opaque token with the server before data renders.
  if (!hasPotentialWebSessionCookie((await cookies()).getAll())) redirect('/login');
  return (
    <ProtectedScreen activePath="/today">
      <TodayContent />
    </ProtectedScreen>
  );
}
