import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { hasPotentialWebSessionCookie } from '../../auth/cookies';
import { HistoryContent } from '../../ui/components/HistoryContent';
import { ProtectedScreen } from '../../ui/components/ProtectedScreen';

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  if (!hasPotentialWebSessionCookie((await cookies()).getAll())) redirect('/login');
  return (
    <ProtectedScreen activePath="/history">
      <HistoryContent />
    </ProtectedScreen>
  );
}
