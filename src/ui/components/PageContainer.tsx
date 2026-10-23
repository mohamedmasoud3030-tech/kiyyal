import type { HTMLAttributes, ReactNode } from 'react';

import { classNames } from './classNames';

export type PageWidth = 'form' | 'standard' | 'wide' | 'document';

export interface PageContainerProps extends HTMLAttributes<HTMLDivElement> {
  readonly children: ReactNode;
  readonly width?: PageWidth;
}

export function PageContainer({ children, className, width = 'standard', ...props }: PageContainerProps) {
  return (
    <div {...props} className={classNames('page-container', `page-container--${width}`, className)}>
      {children}
    </div>
  );
}
