'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ar } from '../copy/ar';
import { apiErrorMessage, ensureCsrfToken } from '../clientSecurity';
import { Amount } from './Amount';
import { Button } from './Button';
import { DataTable, type DataTableColumn } from './DataTable';
import { FormField } from './FormField';
import { PageContainer } from './PageContainer';
import { PageHeader } from './PageHeader';
import { Section } from './Section';
import { StatePanel } from './StatePanel';
import { TextInput } from './TextInput';
import { Weight } from './Weight';

type Allocation = { id: string; material_id: string | null; role: string; kg: string; ref_sell_price_snapshot: string | null; allocated_value: string | null; allocated_cost_per_kg: string | null; sold_kg_at_resolution: string | null; unattributed_value: string | null; to_inventory_value: string | null; is_cost_unallocated: boolean };
type Detail = { id: string; status: string; business_date: string; number: string | null; allocation_method: string; unallocated_regrade_cost: string | null; resolved_at: string | null; allocations: Allocation[]; lines: Array<Record<string, unknown>> };
export function RegradeDetailContent({ transactionId }: { readonly transactionId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null); const [state, setState] = useState<'loading'|'loaded'|'error'>('loading'); const [prices, setPrices] = useState<Record<string, string>>({}); const [message, setMessage] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { const controller = new AbortController(); void fetch(`/api/transactions/regrade/${encodeURIComponent(transactionId)}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }).then(async (response) => { const payload = await response.json() as Detail; if (!response.ok || !payload.id) throw new Error('regrade'); setDetail(payload); setState('loaded'); }).catch((error: unknown) => { if (error instanceof DOMException && error.name === 'AbortError') return; setState('error'); }); return () => controller.abort(); }, [transactionId]);
  if (state === 'loading') return <PageContainer><StatePanel title={ar.regrade.detailTitle} description={ar.common.loading} /></PageContainer>; if (state === 'error' || !detail) return <PageContainer><StatePanel title={ar.regrade.unavailableTitle} description={ar.regrade.unavailableDescription} tone="danger" /></PageContainer>;
  const outputs = detail.allocations.filter((item) => item.role === 'output');
  const outputColumns: readonly DataTableColumn<Allocation>[] = [
    { key: 'material', header: ar.regrade.outputMaterialLabel, cell: (output) => <bdi dir="ltr">{output.material_id ?? ar.directory.emptyValue}</bdi> },
    { key: 'original-quantity', header: ar.regrade.originalQuantityLabel, cell: (output) => <Weight value={output.kg} /> },
    { key: 'sold-quantity', header: ar.regrade.soldQuantityLabel, cell: (output) => output.sold_kg_at_resolution ? <Weight value={output.sold_kg_at_resolution} /> : ar.directory.emptyValue },
    { key: 'remaining-quantity', header: ar.regrade.remainingQuantityLabel, cell: (output) => output.sold_kg_at_resolution ? ar.regrade.resolveSuccessTitle : ar.directory.emptyValue },
    { key: 'inventory-allocation', header: ar.regrade.inventoryAllocationLabel, cell: (output) => output.to_inventory_value ? <Amount value={output.to_inventory_value} approximate /> : ar.directory.emptyValue },
  ];
  async function resolve(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (busy) return; const csrf = await ensureCsrfToken(); const key = globalThis.crypto?.randomUUID(); if (!csrf || !key) { setMessage(ar.auth.csrfUnavailable); return; } setBusy(true); const response = await fetch(`/api/transactions/regrade/${encodeURIComponent(transactionId)}/resolve`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'idempotency-key': key, 'x-kayyal-csrf': csrf }, body: JSON.stringify({ prices: outputs.map((output) => ({ material_id: output.material_id, reference_sell_price_per_kg: prices[output.material_id ?? ''] ?? '' })) }) }); const payload = await response.json().catch(() => null) as { error?: unknown; total_unattributed_value?: string; total_to_inventory_value?: string } | null; setBusy(false); if (!response.ok || !payload) setMessage(apiErrorMessage(payload) ?? ar.regrade.unavailableDescription); else { setMessage(ar.regrade.resolveSuccessTitle); setDetail((current) => current ? { ...current, resolved_at: new Date().toISOString(), unallocated_regrade_cost: null } : current); } }
  return <PageContainer width="wide"><PageHeader title={ar.regrade.detailTitle} description={ar.regrade.detailDescription} backHref="/regrade" backLabel={ar.regrade.detailTitle} /><Section title={detail.resolved_at ? ar.regrade.resolvedTitle : ar.regrade.deferredTitle} description={detail.resolved_at ? ar.regrade.resolveSuccessTitle : ar.regrade.deferredDescription}><dl className="detail-list"><div><dt>{ar.receipt.businessDateLabel}</dt><dd>{detail.business_date}</dd></div><div><dt>{ar.regrade.snapshotMethodLabel}</dt><dd>{detail.allocation_method}</dd></div><div><dt>{ar.regrade.deferredTitle}</dt><dd>{detail.unallocated_regrade_cost ? <Amount value={detail.unallocated_regrade_cost} approximate /> : ar.regrade.resolvedTitle}</dd></div></dl></Section><Section title={ar.regrade.outputsTitle}><DataTable ariaLabel={ar.regrade.outputsTitle} caption={ar.regrade.outputsTitle} rows={outputs} columns={outputColumns} getRowKey={(output) => output.id} wrapperClassName="regrade-preview-table-wrap" tableClassName="regrade-preview-table" emptyMessage={ar.directory.emptyValue} /></Section>{!detail.resolved_at ? <Section title={ar.regrade.resolveAction} description={ar.regrade.resolveDescription}><form className="regrade-form" onSubmit={resolve}><div className="regrade-resolve-fields">{outputs.map((output) => <FormField key={output.id} id={`resolve-${output.id}`} label={`${ar.regrade.resolvePriceLabel} — ${output.material_id}`}><TextInput inputMode="decimal" value={prices[output.material_id ?? ''] ?? ''} onChange={(event) => setPrices((current) => ({ ...current, [output.material_id ?? '']: event.target.value }))} /></FormField>)}</div><Button type="submit" loading={busy}>{ar.regrade.resolveAction}</Button></form>{message ? <p className="form-feedback" role="status">{message}</p> : null}</Section> : null}</PageContainer>;
}
