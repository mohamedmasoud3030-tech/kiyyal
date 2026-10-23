import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { hasPotentialWebSessionCookie } from '../../../auth/cookies';
import { InventoryDetailContent } from '../../../ui/components/InventoryDetailContent';
import { ProtectedScreen } from '../../../ui/components/ProtectedScreen';

export const dynamic = 'force-dynamic';

interface InventoryDetailPageProps {
  readonly params: Promise<{ materialId: string }>;
}

export default async function InventoryDetailPage({ params }: InventoryDetailPageProps) {
  if (!hasPotentialWebSessionCookie((await cookies()).getAll())) redirect('/login');
  const { materialId } = await params;
  return (
    <ProtectedScreen activePath="/inventory">
      <InventoryDetailContent materialId={materialId} />
    </ProtectedScreen>
  );
}
