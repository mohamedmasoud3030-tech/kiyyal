import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { hasPotentialWebSessionCookie } from '../../auth/cookies';
import { ProtectedScreen } from '../../ui/components/ProtectedScreen';
import { ReportsContent } from '../../ui/components/ReportsContent';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  if (!hasPotentialWebSessionCookie((await cookies()).getAll())) redirect('/login');
  return (
    <ProtectedScreen activePath="/reports">
      <ReportsContent />
    </ProtectedScreen>
  );
}
