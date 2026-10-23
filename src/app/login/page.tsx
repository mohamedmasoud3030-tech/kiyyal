import { PageContainer } from '../../ui/components/PageContainer';
import { OperatorLoginForm } from '../../ui/components/OperatorLoginForm';
import { OwnerLoginForm } from '../../ui/components/OwnerLoginForm';
import { PageHeader } from '../../ui/components/PageHeader';
import { PublicShell } from '../../ui/components/PublicShell';
import { Section } from '../../ui/components/Section';
import { ar } from '../../ui/copy/ar';

export default function LoginPage() {
  return (
    <PublicShell>
      <PageContainer width="form">
        <PageHeader description={ar.auth.description} title={ar.auth.title} />
        <Section description={ar.auth.operatorDescription} title={ar.auth.operatorTitle}>
          <OperatorLoginForm />
        </Section>
        <Section description={ar.auth.ownerDescription} title={ar.auth.ownerTitle}>
          <OwnerLoginForm />
        </Section>
      </PageContainer>
    </PublicShell>
  );
}
