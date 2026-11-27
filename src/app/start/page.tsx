import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { ProtectedScreen } from '../../ui/components/ProtectedScreen';
import { FirstRunContent } from '../../ui/components/FirstRunContent';
import { hasPotentialWebSessionCookie } from '../../auth/cookies';

export const dynamic = 'force-dynamic';

export default async function StartPage() {
  if (!hasPotentialWebSessionCookie((await cookies()).getAll())) redirect('/login');
  return (
    <ProtectedScreen activePath="/start">
      <FirstRunContent />
    </ProtectedScreen>
  );
}
