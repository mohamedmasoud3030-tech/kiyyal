import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { hasPotentialWebSessionCookie } from '../../../auth/cookies';
import { DirectoryDetailContent } from '../../../ui/components/DirectoryDetailContent';
import { ProtectedScreen } from '../../../ui/components/ProtectedScreen';

export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ buyerId: string }> };

export default async function DirectoryBuyerPage({ params }: PageProps) {
  if (!hasPotentialWebSessionCookie((await cookies()).getAll())) redirect('/login');
  const { buyerId } = await params;
  return (
    <ProtectedScreen activePath="/directory">
      <DirectoryDetailContent buyerId={buyerId} />
    </ProtectedScreen>
  );
}
