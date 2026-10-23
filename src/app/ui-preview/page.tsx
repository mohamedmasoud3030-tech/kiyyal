import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Alert } from '../../ui/components/Alert';
import { AppShell } from '../../ui/components/AppShell';
import { Button } from '../../ui/components/Button';
import { FormField } from '../../ui/components/FormField';
import { NumericInput } from '../../ui/components/NumericInput';
import { PageContainer } from '../../ui/components/PageContainer';
import { PageHeader } from '../../ui/components/PageHeader';
import { Section } from '../../ui/components/Section';
import { ar, type AppRole } from '../../ui/copy/ar';

interface UiPreviewPageProps {
  readonly searchParams: Promise<{ role?: string }>;
}

function previewRole(value: string | undefined): AppRole {
  return value === 'operator' ? 'operator' : 'owner';
}

function OwnerPreview() {
  return (
    <>
      <Alert title={ar.preview.unavailableDataTitle} tone="warning">
        <p>{ar.preview.unavailableDataDescription}</p>
      </Alert>
      <Section description={ar.preview.ownerDescription} title={ar.preview.ownerContentTitle} tone="outlined">
        <p className="preview-copy">{ar.preview.ownerContentDescription}</p>
      </Section>
    </>
  );
}

function OperatorPreview() {
  return (
    <Section description={ar.preview.operatorDescription} title={ar.preview.operatorContentTitle} tone="outlined">
      <p className="preview-copy">{ar.preview.operatorContentDescription}</p>
      <div className="preview-action-grid">
        <Button disabled size="lg">{ar.preview.purchaseAction}</Button>
        <Button disabled size="lg" variant="secondary">{ar.preview.saleAction}</Button>
      </div>
    </Section>
  );
}

function FormPreview() {
  return (
    <Section description={ar.preview.formDescription} title={ar.preview.formTitle} tone="outlined">
      <FormField hint={ar.preview.formWeightHint} id="preview-weight" label={ar.preview.formWeightLabel} required>
        <NumericInput placeholder={ar.preview.formWeightPlaceholder} unit={ar.units.kilogram} />
      </FormField>
    </Section>
  );
}

export default async function UiPreviewPage({ searchParams }: UiPreviewPageProps) {
  if (process.env.NODE_ENV === 'production') notFound();

  const parameters = await searchParams;
  const role = previewRole(parameters.role);
  const title = role === 'owner' ? ar.preview.ownerTitle : ar.preview.operatorTitle;
  const toggleHref = role === 'owner' ? '/ui-preview?role=operator' : '/ui-preview?role=owner';
  const toggleLabel = role === 'owner' ? ar.preview.switchToOperator : ar.preview.switchToOwner;

  return (
    <AppShell activePath="/today" connection={{ label: ar.preview.noDataConnection, tone: 'neutral' }} role={role}>
      <PageContainer width="standard">
        <PageHeader
          action={<Link className="ui-link" href={toggleHref}>{toggleLabel}</Link>}
          description={ar.preview.description}
          eyebrow={ar.preview.previewEyebrow}
          title={title}
        />
        <div className="preview-content">
          {role === 'owner' ? <OwnerPreview /> : <OperatorPreview />}
          <FormPreview />
        </div>
      </PageContainer>
    </AppShell>
  );
}
