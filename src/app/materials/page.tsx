import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { hasPotentialWebSessionCookie } from '../../auth/cookies';
import { ProtectedScreen } from '../../ui/components/ProtectedScreen';
import { MaterialsContent } from '../../ui/components/MaterialsContent';

export const dynamic = 'force-dynamic';

export default async function MaterialsPage() {
  if (!hasPotentialWebSessionCookie((await cookies()).getAll())) redirect('/login');
  return (
    <ProtectedScreen activePath="/materials">
      <MaterialsContent />
    </ProtectedScreen>
  );
}
