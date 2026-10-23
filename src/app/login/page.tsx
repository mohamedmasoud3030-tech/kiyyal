import { PageContainer } from '../../ui/components/PageContainer';
import { OperatorLoginForm } from '../../ui/components/OperatorLoginForm';
import { OwnerLoginForm } from '../../ui/components/OwnerLoginForm';
import { PublicShell } from '../../ui/components/PublicShell';
import { Section } from '../../ui/components/Section';
import { ar } from '../../ui/copy/ar';

// One primary path: the yard owner. Operator access stays one tap away inside
// a collapsed disclosure so the page reads as a single, calm sign-in choice.
export default function LoginPage() {
  return (
    <PublicShell>
      <PageContainer width="form">
        <Section description={ar.auth.ownerDescription} title={ar.auth.ownerTitle}>
          <OwnerLoginForm />
        </Section>
        <details className="login-operator">
          <summary>{ar.auth.operatorTitle}</summary>
          <div className="login-operator__body">
            <p className="login-operator__hint">{ar.auth.operatorDescription}</p>
            <OperatorLoginForm />
          </div>
        </details>
      </PageContainer>
    </PublicShell>
  );
}
