import type { ReactNode } from 'react';

import Link from 'next/link';

import { classNames } from './classNames';

export interface PageHeaderProps {
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly backHref?: string;
  readonly backLabel?: string;
  readonly eyebrow?: string;
}

export function PageHeader({
  action,
  backHref,
  backLabel,
  description,
  eyebrow,
  title,
}: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header__identity">
        {backHref && backLabel ? <Link prefetch={false} className="page-header__back" href={backHref}>{backLabel}</Link> : null}
        {eyebrow ? <p className="page-header__eyebrow">{eyebrow}</p> : null}
        <h1 className="page-header__title">{title}</h1>
        {description ? <p className="page-header__description">{description}</p> : null}
      </div>
      {action ? <div className={classNames('page-header__action')}>{action}</div> : null}
    </header>
  );
}
