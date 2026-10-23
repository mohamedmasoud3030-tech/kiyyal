import type { HTMLAttributes } from 'react';

import { ar } from '../copy/ar';
import { formatCanonicalDecimal } from '../format';
import { classNames } from './classNames';

export interface AmountProps extends HTMLAttributes<HTMLSpanElement> {
  readonly value: string;
  readonly approximate?: boolean;
  readonly emphasis?: boolean;
}

export function Amount({ approximate = false, className, emphasis = false, value, ...props }: AmountProps) {
  const formatted = formatCanonicalDecimal(value, 2);
  const accessibleValue = approximate
    ? `${formatted} ${ar.units.currencyLong} ${ar.common.approximate}`
    : `${formatted} ${ar.units.currencyLong}`;

  return (
    <span
      {...props}
      aria-label={accessibleValue}
      className={classNames('amount', emphasis && 'amount--emphasis', className)}
    >
      <bdi aria-hidden="true" dir="ltr">{formatted}&nbsp;{ar.units.currencyShort}</bdi>
      {approximate ? <span className="amount__approximate">{ar.common.approximate}</span> : null}
    </span>
  );
}
