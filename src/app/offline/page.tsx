import Link from 'next/link';

import { PageContainer } from '../../ui/components/PageContainer';
import { PublicShell } from '../../ui/components/PublicShell';
import { StatePanel } from '../../ui/components/StatePanel';
import { ar } from '../../ui/copy/ar';

export default function OfflinePage() {
  return (
    <PublicShell>
      <PageContainer width="form">
        <StatePanel
          action={<Link className="ui-link" href="/login">{ar.common.returnToLogin}</Link>}
          description={ar.state.offlineDescription}
          headingLevel={1}
          title={ar.state.offlineTitle}
          tone="warning"
        />
      </PageContainer>
    </PublicShell>
  );
}
