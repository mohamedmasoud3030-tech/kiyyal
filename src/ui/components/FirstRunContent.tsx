'use client';

import Link from 'next/link';

import { ar, type AppRole } from '../copy/ar';
import { requireInjectedRole } from '../requiredRole';
import { isSetupComplete, useSetupStatus } from '../hooks/useSetupStatus';
import { PageContainer } from './PageContainer';
import { PageHeader } from './PageHeader';
import { Section } from './Section';
import { StatePanel } from './StatePanel';

interface StepView {
  readonly key: 'materials' | 'parties' | 'purchase';
  readonly href: string;
  readonly done: boolean;
  readonly current: boolean;
}

export function FirstRunContent({ role }: { readonly role?: AppRole }) {
  const resolvedRole = requireInjectedRole(role);
  const state = useSetupStatus();

  if (resolvedRole !== 'owner') {
    return (
      <PageContainer>
        <StatePanel description={ar.firstRun.ownerOnly} headingLevel={1} title={ar.firstRun.title} />
      </PageContainer>
    );
  }

  if (state.status === 'loading') {
    return (
      <PageContainer>
        <StatePanel description={ar.firstRun.description} headingLevel={1} title={ar.common.loading} />
      </PageContainer>
    );
  }
  if (state.status === 'error') {
    return (
      <PageContainer>
        <StatePanel description={ar.firstRun.statusError} headingLevel={1} title={ar.firstRun.title} tone="warning" />
      </PageContainer>
    );
  }

  const { setup } = state;
  const complete = isSetupComplete(setup);
  const rawSteps: ReadonlyArray<Omit<StepView, 'current'>> = [
    { key: 'materials', href: '/materials', done: setup.materialsCount > 0 },
    { key: 'parties', href: '/parties', done: setup.partiesCount > 0 },
    { key: 'purchase', href: '/purchase', done: setup.hasPurchase },
  ];
  const firstPending = rawSteps.findIndex(step => !step.done);
  const steps: readonly StepView[] = rawSteps.map((step, index) => ({ ...step, current: index === firstPending }));

  return (
    <PageContainer>
      <PageHeader
        description={ar.firstRun.description}
        eyebrow={ar.firstRun.eyebrow}
        title={ar.firstRun.title}
      />
      {complete ? (
        <Section title={ar.firstRun.allDoneTitle}>
          <div className="first-run-done">
            <p>{ar.firstRun.allDoneDescription}</p>
            <Link className="first-run-done__action" href="/today" prefetch={false}>{ar.firstRun.allDoneAction}</Link>
          </div>
        </Section>
      ) : (
        <Section title={ar.firstRun.title}>
          <ol className="first-run-steps">
            {steps.map((step) => {
              const copy = ar.firstRun.steps[step.key];
              const stateLabel = step.done ? ar.firstRun.stepDone : step.current ? ar.firstRun.stepCurrent : ar.firstRun.stepPending;
              return (
                <li className={`first-run-step${step.done ? ' first-run-step--done' : ''}${step.current ? ' first-run-step--current' : ''}`} key={step.key}>
                  <div className="first-run-step__body">
                    <h2>{copy.title}</h2>
                    <p>{copy.description}</p>
                  </div>
                  {step.done ? (
                    <span className="first-run-step__state">{stateLabel}</span>
                  ) : (
                    <Link className="first-run-step__action" href={step.href} prefetch={false}>{copy.action}</Link>
                  )}
                </li>
              );
            })}
          </ol>
        </Section>
      )}
    </PageContainer>
  );
}
