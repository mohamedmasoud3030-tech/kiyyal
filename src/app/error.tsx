'use client';

import { Button } from '../ui/components/Button';
import { PageContainer } from '../ui/components/PageContainer';
import { PublicShell } from '../ui/components/PublicShell';
import { StatePanel } from '../ui/components/StatePanel';
import { ar } from '../ui/copy/ar';

export default function GlobalError({ reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return (
    <PublicShell>
      <PageContainer width="form">
        <StatePanel
          action={<Button onClick={reset}>{ar.common.tryAgain}</Button>}
          description={ar.state.errorDescription}
          headingLevel={1}
          title={ar.state.errorTitle}
          tone="danger"
        />
      </PageContainer>
    </PublicShell>
  );
}
