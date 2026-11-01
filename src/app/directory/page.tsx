import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { hasPotentialWebSessionCookie } from '../../auth/cookies';
import { DirectoryContent } from '../../ui/components/DirectoryContent';
import { ProtectedScreen } from '../../ui/components/ProtectedScreen';

export const dynamic = 'force-dynamic';

export default async function DirectoryPage() {
  if (!hasPotentialWebSessionCookie((await cookies()).getAll())) redirect('/login');
  return (
    <ProtectedScreen activePath="/directory">
      <DirectoryContent />
    </ProtectedScreen>
  );
}
