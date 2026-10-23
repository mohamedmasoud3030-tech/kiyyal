import type { HTMLAttributes } from 'react';

import { ar } from '../copy/ar';
import { formatCanonicalDecimal } from '../format';
import { classNames } from './classNames';

export interface WeightProps extends HTMLAttributes<HTMLSpanElement> {
  readonly value: string;
  readonly emphasis?: boolean;
}

export interface PriceWithUnitProps extends HTMLAttributes<HTMLSpanElement> {
  readonly value: string;
  readonly unit: 'kg' | 'ton';
  readonly overridden?: boolean;
}

export function Weight({ className, emphasis = false, value, ...props }: WeightProps) {
  const formatted = formatCanonicalDecimal(value, 2);
  const accessibleValue = `${formatted} ${ar.units.kilogram}`;

  return (
    <span
      {...props}
      aria-label={accessibleValue}
      className={classNames('weight', emphasis && 'weight--emphasis', className)}
    >
      <bdi aria-hidden="true" dir="ltr">{formatted}&nbsp;{ar.units.kilogram}</bdi>
    </span>
  );
}

export function PriceWithUnit({ className, overridden = false, unit, value, ...props }: PriceWithUnitProps) {
  const formatted = formatCanonicalDecimal(value, 4);
  const unitLabel = unit === 'kg' ? ar.units.kilogram : ar.units.ton;
  const accessibleValue = `${formatted} ${ar.units.currencyLong} ${ar.units.per} ${unitLabel}`;

  return (
    <span
      {...props}
      aria-label={accessibleValue}
      className={classNames('price-with-unit', overridden && 'price-with-unit--overridden', className)}
    >
      <bdi aria-hidden="true" dir="ltr">{formatted}&nbsp;{ar.units.currencyShort}</bdi>
      <span className="price-with-unit__unit">/{unitLabel}</span>
      {overridden ? <span className="price-with-unit__override-mark">*</span> : null}
    </span>
  );
}
