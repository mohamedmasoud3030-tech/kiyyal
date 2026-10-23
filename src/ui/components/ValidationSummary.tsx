import { ar } from '../copy/ar';

export interface ValidationIssue {
  readonly fieldId: string;
  readonly message: string;
}

export interface ValidationSummaryProps {
  readonly issues: readonly ValidationIssue[];
}

export function ValidationSummary({ issues }: ValidationSummaryProps) {
  if (issues.length === 0) return null;

  return (
    <section className="validation-summary" role="alert">
      <h2 className="validation-summary__title">{ar.form.validationTitle}</h2>
      <ul className="validation-summary__list">
        {issues.map((issue) => (
          <li key={`${issue.fieldId}-${issue.message}`}>
            <a href={`#${issue.fieldId}`}>{issue.message}</a>
          </li>
        ))}
      </ul>
    </section>
  );
}
