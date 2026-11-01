'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ar, type AppRole } from '../copy/ar';
import { requireInjectedRole } from '../requiredRole';
import { apiErrorMessage } from '../clientSecurity';
import { Button } from './Button';
import { FormField } from './FormField';
import { PageContainer } from './PageContainer';
import { PageHeader } from './PageHeader';
import { Section } from './Section';
import { StatePanel } from './StatePanel';
import { TextInput } from './TextInput';

const reportNames = ['purchases','sales','cash','inventory','inventory_value','supplier_balances','customer_balances','profit','movements'] as const;
type ReportName = (typeof reportNames)[number];
type ReportState = { status: 'idle' } | { status: 'loading' } | { status: 'loaded'; rows: Record<string, unknown>[]; summary: Record<string, string> } | { status: 'error'; message?: string };
type FilterOption = { id: string; label: string };

function isReportName(value: string): value is ReportName { return reportNames.includes(value as ReportName); }
function safeText(value: unknown): string { return value == null ? ar.reports.emptyValue : String(value); }

export function ReportsContent({ role: injectedRole }: { readonly role?: AppRole }) {
  const role = requireInjectedRole(injectedRole);
  const [report, setReport] = useState<ReportName>('purchases');
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [materialId, setMaterialId] = useState(''); const [partyId, setPartyId] = useState(''); const [userId, setUserId] = useState('');
  const [state, setState] = useState<ReportState>({ status: 'idle' }); const [requestKey, setRequestKey] = useState(0);
  const [materials, setMaterials] = useState<FilterOption[]>([]); const [parties, setParties] = useState<FilterOption[]>([]); const [users, setUsers] = useState<FilterOption[]>([]);
  const invalidRange = Boolean(from && to && from > to);
  const query = useMemo(() => {
    const params = new URLSearchParams({ report });
    if (from) params.set('from', from); if (to) params.set('to', to); if (materialId) params.set('material_id', materialId); if (partyId) params.set('party_id', partyId); if (userId) params.set('user_id', userId); params.set('limit', '500'); return params.toString();
  }, [from, materialId, partyId, report, to, userId]);
  useEffect(() => {
    if (role !== 'owner') return;
    const controller = new AbortController();
    void Promise.all([
      fetch('/api/materials', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }),
      fetch('/api/parties', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }),
      fetch('/api/users', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }),
    ]).then(async ([materialsResponse, partiesResponse, usersResponse]) => {
      if (!materialsResponse.ok || !partiesResponse.ok || !usersResponse.ok) return;
      const materialsPayload = await materialsResponse.json() as { data?: Array<{ id: string; display_name: string }> };
      const partiesPayload = await partiesResponse.json() as { data?: Array<{ id: string; name: string | null; phone: string | null }> };
      const usersPayload = await usersResponse.json() as { data?: Array<{ id: string; display_name: string }> };
      setMaterials((materialsPayload.data ?? []).map((item) => ({ id: item.id, label: item.display_name })));
      setParties((partiesPayload.data ?? []).map((item) => ({ id: item.id, label: item.name ?? item.phone ?? item.id })));
      setUsers((usersPayload.data ?? []).map((item) => ({ id: item.id, label: item.display_name })));
    }).catch(() => undefined);
    return () => controller.abort();
  }, [role]);
  useEffect(() => {
    if (role !== 'owner') return;
    const controller = new AbortController(); setState({ status: 'loading' });
    void fetch(`/api/reports?${query}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }).then(async (response) => {
      const payload = await response.json().catch(() => null) as { rows?: unknown; summary?: unknown; error?: unknown } | null;
      if (!response.ok || !payload || !Array.isArray(payload.rows) || !payload.summary || typeof payload.summary !== 'object') throw new Error(apiErrorMessage(payload) ?? 'report');
      setState({ status: 'loaded', rows: payload.rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object'), summary: payload.summary as Record<string, string> });
    }).catch((error: unknown) => { if (error instanceof DOMException && error.name === 'AbortError') return; setState(error instanceof Error ? { status: 'error', message: error.message } : { status: 'error' }); });
    return () => controller.abort();
  }, [query, requestKey, role]);
  function apply(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!invalidRange) setRequestKey((value) => value + 1); }
  function reset() { setFrom(''); setTo(''); setMaterialId(''); setPartyId(''); setUserId(''); setRequestKey((value) => value + 1); }
  function print() { window.print(); }
  async function share() {
    const summaryText = state.status === 'loaded'
      ? Object.entries(state.summary).map(([key, value]) => `${ar.reports.summaryLabels[key as keyof typeof ar.reports.summaryLabels] ?? key}: ${safeText(value)}`).join(ar.directory.listSeparator)
      : ar.reports.loadingTitle;
    const text = `${ar.reports.shareText}: ${ar.reports.reportLabels[report]}\n${summaryText}`;
    if (navigator.share) await navigator.share({ title: text, text }).catch(() => undefined); else await navigator.clipboard?.writeText(text).catch(() => undefined);
  }
  const keys = state.status === 'loaded' && state.rows[0] ? Object.keys(state.rows[0]) : [];
  if (role !== 'owner') return <PageContainer><StatePanel title={ar.state.forbiddenTitle} description={ar.reports.unavailableDescription} tone="warning" /></PageContainer>;
  return <PageContainer width="wide">
    <PageHeader title={ar.reports.title} description={ar.reports.description} />
    <Section title={ar.reports.filtersTitle} description={ar.reports.snapshotHint} tone="muted">
      <form className="operations-form" onSubmit={apply}>
        <FormField id="report-kind" label={ar.reports.reportTypeLabel}><select className="text-input" value={report} onChange={(event) => { const value = event.target.value; if (isReportName(value)) setReport(value); }}><option value="purchases">{ar.reports.reportLabels.purchases}</option>{reportNames.slice(1).map((name) => <option key={name} value={name}>{ar.reports.reportLabels[name]}</option>)}</select></FormField>
        <FormField id="report-from" label={ar.reports.fromLabel}><TextInput type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></FormField>
        <FormField {...(invalidRange ? { error: ar.history.invalidDateRange } : {})} id="report-to" label={ar.reports.toLabel}><TextInput type="date" value={to} onChange={(event) => setTo(event.target.value)} /></FormField>
        <FormField id="report-material" label={ar.reports.materialLabel}><select className="text-input" value={materialId} onChange={(event) => setMaterialId(event.target.value)}><option value="">{ar.reports.allOption}</option>{materials.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></FormField>
        <FormField id="report-party" label={ar.reports.partyLabel}><select className="text-input" value={partyId} onChange={(event) => setPartyId(event.target.value)}><option value="">{ar.reports.allOption}</option>{parties.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></FormField>
        <FormField id="report-user" label={ar.reports.userLabel}><select className="text-input" value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">{ar.reports.allOption}</option>{users.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></FormField>
        <div className="form-actions"><Button type="submit">{ar.reports.applyAction}</Button><Button variant="secondary" onClick={reset}>{ar.reports.resetAction}</Button></div>
      </form>
    </Section>
    <div className="report-toolbar"><Button variant="secondary" onClick={print}>{ar.reports.printAction}</Button><Button variant="secondary" onClick={() => { window.location.href = `/api/export?format=csv&${query}`; }}>{ar.reports.exportAction}</Button><Button variant="secondary" onClick={() => void share()}>{ar.reports.shareAction}</Button></div>
    {state.status === 'loading' ? <StatePanel title={ar.reports.loadingTitle} description={ar.reports.description} /> : null}
    {state.status === 'error' ? <StatePanel title={ar.reports.unavailableTitle} description={state.message ?? ar.reports.unavailableDescription} tone="danger" /> : null}
    {state.status === 'loaded' && state.rows.length === 0 ? <StatePanel title={ar.reports.emptyTitle} description={ar.reports.emptyDescription} /> : null}
    {state.status === 'loaded' ? <>
      <Section title={ar.reports.summaryTitle}><dl className="report-summary">{Object.entries(state.summary).map(([key, value]) => <div key={key}><dt>{ar.reports.summaryLabels[key as keyof typeof ar.reports.summaryLabels] ?? key}</dt><dd><bdi dir="ltr">{safeText(value)}</bdi></dd></div>)}</dl></Section>
      {state.rows.length ? <Section title={`${ar.reports.rowsTitle} (${state.rows.length})`}><div className="table-scroll"><table className="data-table"><thead><tr>{keys.map((key) => <th key={key} scope="col">{ar.reports.columns[key as keyof typeof ar.reports.columns] ?? key}</th>)}</tr></thead><tbody>{state.rows.map((row, index) => <tr key={`${String(row.id ?? index)}-${index}`}>{keys.map((key) => <td key={key}><bdi dir="ltr">{safeText(row[key])}</bdi></td>)}</tr>)}</tbody></table></div></Section> : null}
    </> : null}
  </PageContainer>;
}
