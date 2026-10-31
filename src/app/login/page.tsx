import { PageContainer } from '../../ui/components/PageContainer';
import { OperatorLoginForm } from '../../ui/components/OperatorLoginForm';
import { OwnerLoginForm } from '../../ui/components/OwnerLoginForm';
import { PublicShell } from '../../ui/components/PublicShell';
import { Section } from '../../ui/components/Section';
import { ar } from '../../ui/copy/ar';
import { BrandMark, WorkspaceIcon } from '../../ui/components/WorkspaceIcon';

// One primary path: the yard owner. Operator access stays one tap away inside
// a collapsed disclosure so the page reads as a single, calm sign-in choice.
export default function LoginPage() {
  return (
    <PublicShell>
      <div className="login-layout">
        <section className="login-story" aria-labelledby="login-welcome">
          <div className="login-story__identity"><BrandMark /><span>{ar.workspace.brandCaption}</span></div>
          <div><p className="login-story__eyebrow">{ar.workspace.loginEyebrow}</p><h1 id="login-welcome">{ar.workspace.loginHeadline}</h1><p className="login-story__description">{ar.workspace.loginDescription}</p></div>
          <div className="login-story__illustration" aria-hidden="true"><WorkspaceIcon name="scale" /><span className="login-story__orbit" /></div>
          <div className="login-story__features"><span><WorkspaceIcon name="purchase" />{ar.navigation.purchase}</span><span><WorkspaceIcon name="sale" />{ar.navigation.sale}</span><span><WorkspaceIcon name="inventory" />{ar.navigation.inventory}</span></div>
        </section>
        <div className="login-panel">
          <p className="login-panel__eyebrow">{ar.workspace.welcomeBack}</p>
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
          <p className="login-panel__footer">{ar.workspace.loginFooter}</p>
        </div>
      </div>
    </PublicShell>
  );
}
