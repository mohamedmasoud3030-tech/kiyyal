import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { ar } from '../copy/ar';
import { classNames } from './classNames';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly children: ReactNode;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly loading?: boolean;
}

export function Button({
  children,
  className,
  disabled,
  loading = false,
  size = 'md',
  type = 'button',
  variant = 'primary',
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      {...props}
      aria-busy={loading || undefined}
      className={classNames('ui-button', `ui-button--${variant}`, `ui-button--${size}`, className)}
      data-loading={loading || undefined}
      disabled={isDisabled}
      type={type}
    >
      {loading ? <span className="visually-hidden">{children} {ar.common.loading}</span> : null}
      <span aria-hidden={loading || undefined}>{children}</span>
    </button>
  );
}
