import type { ReactNode } from 'react';

import { classNames } from './classNames';

export type StatePanelTone = 'info' | 'warning' | 'danger';

export interface StatePanelProps {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
  readonly tone?: StatePanelTone;
  readonly headingLevel?: 1 | 2;
}

export function StatePanel({ action, description, headingLevel = 2, title, tone = 'info' }: StatePanelProps) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  const role = tone === 'danger' ? 'alert' : 'status';

  return (
    <section className={classNames('state-panel', `state-panel--${tone}`)} role={role}>
      <Heading className="state-panel__title">{title}</Heading>
      <p className="state-panel__description">{description}</p>
      {action ? <div className="state-panel__action">{action}</div> : null}
    </section>
  );
}
