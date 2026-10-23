import type { HTMLAttributes, ReactNode } from 'react';

import { classNames } from './classNames';

export type SectionTone = 'plain' | 'outlined' | 'critical' | 'muted';

export interface SectionProps extends HTMLAttributes<HTMLElement> {
  readonly title: string;
  readonly children: ReactNode;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly tone?: SectionTone;
  readonly headingLevel?: 2 | 3;
}

export function Section({
  action,
  children,
  className,
  description,
  headingLevel = 2,
  title,
  tone = 'outlined',
  ...props
}: SectionProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';

  return (
    <section {...props} className={classNames('ui-section', `ui-section--${tone}`, className)}>
      <div className="ui-section__header">
        <div>
          <Heading className="ui-section__title">{title}</Heading>
          {description ? <p className="ui-section__description">{description}</p> : null}
        </div>
        {action ? <div className="ui-section__action">{action}</div> : null}
      </div>
      <div className="ui-section__body">{children}</div>
    </section>
  );
}
