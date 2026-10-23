import type { ReactNode } from 'react';

import { classNames } from './classNames';

export interface FormActionsProps {
  readonly children: ReactNode;
  readonly status?: ReactNode;
  readonly stickyOnMobile?: boolean;
}

export function FormActions({ children, status, stickyOnMobile = false }: FormActionsProps) {
  return (
    <div className={classNames('form-actions', stickyOnMobile && 'form-actions--sticky-mobile')}>
      {status ? <div aria-live="polite" className="form-actions__status">{status}</div> : null}
      <div className="form-actions__controls">{children}</div>
    </div>
  );
}
