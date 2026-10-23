import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { hasPotentialWebSessionCookie } from '../../auth/cookies';
import { InventoryContent } from '../../ui/components/InventoryContent';
import { ProtectedScreen } from '../../ui/components/ProtectedScreen';

export const dynamic = 'force-dynamic';

export default async function InventoryPage() {
  if (!hasPotentialWebSessionCookie((await cookies()).getAll())) redirect('/login');
  return (
    <ProtectedScreen activePath="/inventory">
      <InventoryContent />
    </ProtectedScreen>
  );
}
