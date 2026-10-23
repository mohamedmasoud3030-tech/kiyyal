import { useId, type InputHTMLAttributes } from 'react';

import { classNames } from './classNames';

export interface NumericInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'inputMode'> {
  readonly unit?: string;
}

export function NumericInput({ className, unit, ...props }: NumericInputProps) {
  const generatedId = useId();
  const unitId = `${props.id ?? generatedId}-unit`;
  const describedBy = [props['aria-describedby'], unit ? unitId : null]
    .filter((value): value is string => Boolean(value))
    .join(' ');

  return (
    <div className={classNames('numeric-input', props['aria-invalid'] === true && 'numeric-input--error')}>
      <input
        {...props}
        aria-describedby={describedBy || undefined}
        className={classNames('numeric-input__control', className)}
        dir="ltr"
        inputMode="decimal"
        type="text"
      />
      {unit ? <span className="numeric-input__unit" id={unitId}>{unit}</span> : null}
    </div>
  );
}
