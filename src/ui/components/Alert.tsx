import type { HTMLAttributes, ReactNode } from 'react';

import { classNames } from './classNames';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  readonly title: string;
  readonly children?: ReactNode;
  readonly tone?: AlertTone;
}

export function Alert({ children, className, title, tone = 'info', ...props }: AlertProps) {
  const role = tone === 'danger' ? 'alert' : 'status';

  return (
    <div {...props} className={classNames('ui-alert', `ui-alert--${tone}`, className)} role={role}>
      <div className="ui-alert__content">
        <strong className="ui-alert__title">{title}</strong>
        {children ? <div className="ui-alert__body">{children}</div> : null}
      </div>
    </div>
  );
}
