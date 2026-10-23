import type { InputHTMLAttributes } from 'react';

import { classNames } from './classNames';

export type TextInputType = 'text' | 'tel' | 'password' | 'search' | 'date';

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  readonly type?: TextInputType;
}

export function TextInput({ className, type = 'text', ...props }: TextInputProps) {
  return (
    <input
      {...props}
      className={classNames('text-input', className)}
      dir={type === 'tel' ? 'ltr' : props.dir}
      type={type}
    />
  );
}
