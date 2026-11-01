import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { hasPotentialWebSessionCookie } from '../../auth/cookies';
import { ProtectedScreen } from '../../ui/components/ProtectedScreen';
import { SettingsContent } from '../../ui/components/SettingsContent';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  if (!hasPotentialWebSessionCookie((await cookies()).getAll())) redirect('/login');
  return (
    <ProtectedScreen activePath="/settings">
      <SettingsContent />
    </ProtectedScreen>
  );
}
