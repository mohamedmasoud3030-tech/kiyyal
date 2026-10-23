import { cloneElement, type ReactElement, type ReactNode } from 'react';

import { ar } from '../copy/ar';
import { classNames } from './classNames';

export interface FieldControlProps {
  readonly id?: string;
  readonly 'aria-describedby'?: string;
  readonly 'aria-invalid'?: boolean;
  readonly 'aria-required'?: boolean;
  readonly required?: boolean;
}

export interface FormFieldProps {
  readonly id: string;
  readonly label: string;
  readonly children: ReactElement<FieldControlProps>;
  readonly hint?: string;
  readonly error?: string;
  readonly required?: boolean;
  readonly action?: ReactNode;
}

export function FormField({ action, children, error, hint, id, label, required = false }: FormFieldProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [children.props['aria-describedby'], hint ? hintId : null, error ? errorId : null]
    .filter((value): value is string => Boolean(value))
    .join(' ');

  const controlProps: FieldControlProps = {
    id,
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    ...(error ? { 'aria-invalid': true } : {}),
    ...(required ? { 'aria-required': true, required: true } : {}),
  };
  const control = cloneElement(children, controlProps);

  return (
    <div className={classNames('form-field', error && 'form-field--error')}>
      <div className="form-field__label-row">
        <label className="form-field__label" htmlFor={id}>
          {label}
          {required ? <span className="form-field__required">{ar.form.required}</span> : null}
        </label>
        {action ? <div className="form-field__action">{action}</div> : null}
      </div>
      {hint ? <p className="form-field__hint" id={hintId}>{hint}</p> : null}
      {control}
      {error ? <p className="form-field__error" id={errorId} role="alert">{error}</p> : null}
    </div>
  );
}
