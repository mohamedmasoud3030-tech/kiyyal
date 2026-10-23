import type { HTMLAttributes } from 'react';

import { classNames } from './classNames';

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'pending';

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly label: string;
  readonly tone?: StatusTone;
}

export function StatusBadge({ className, label, tone = 'neutral', ...props }: StatusBadgeProps) {
  return (
    <span {...props} className={classNames('status-badge', `status-badge--${tone}`, className)}>
      <span aria-hidden="true" className="status-badge__marker" />
      {label}
    </span>
  );
}
