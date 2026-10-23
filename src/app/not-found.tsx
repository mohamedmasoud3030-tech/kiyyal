import Link from 'next/link';

import { PageContainer } from '../ui/components/PageContainer';
import { PublicShell } from '../ui/components/PublicShell';
import { StatePanel } from '../ui/components/StatePanel';
import { ar } from '../ui/copy/ar';

export default function NotFound() {
  return (
    <PublicShell>
      <PageContainer width="form">
        <StatePanel
          action={<Link className="ui-link" href="/login">{ar.common.returnToLogin}</Link>}
          description={ar.state.notFoundDescription}
          headingLevel={1}
          title={ar.state.notFoundTitle}
          tone="warning"
        />
      </PageContainer>
    </PublicShell>
  );
}
