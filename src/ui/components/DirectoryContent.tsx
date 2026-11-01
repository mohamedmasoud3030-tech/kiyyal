'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { ar, type AppRole } from '../copy/ar';
import { requireInjectedRole } from '../requiredRole';
import { Button } from './Button';
import { FormField } from './FormField';
import { PageContainer } from './PageContainer';
import { PageHeader } from './PageHeader';
import { Section } from './Section';
import { StatePanel } from './StatePanel';
import { StatusBadge } from './StatusBadge';
import { TextInput } from './TextInput';

type Buyer = { id: string; name: string; entity_type: string; governorates: string[]; phone: string | null; whatsapp: string | null; address: string | null; min_quantity_kg: string | null; logistics: keyof typeof ar.directory.logistics; last_verified_at: string | null; status: 'verified' | 'unverified' | 'stale'; materials?: Array<{ material_type: string; material_grade: string | null }> };
function statusLabel(status: Buyer['status']) { return status === 'verified' ? ar.directory.statusActive : status === 'stale' ? ar.directory.statusOutdated : ar.directory.statusUnverified; }
function entityLabel(type: string) { return ar.directory.entityTypes[type as keyof typeof ar.directory.entityTypes] ?? type; }

export function DirectoryContent({ role: injectedRole }: { readonly role?: AppRole }) {
  const role = requireInjectedRole(injectedRole); const [buyers, setBuyers] = useState<Buyer[]>([]); const [state, setState] = useState<'loading'|'loaded'|'error'>('loading'); const [material, setMaterial] = useState(''); const [governorate, setGovernorate] = useState(''); const [status, setStatus] = useState(''); const [run, setRun] = useState(0);
  useEffect(() => { if (role !== 'owner') return; const controller = new AbortController(); setState('loading'); const params = new URLSearchParams(); if (material) params.set('material', material); if (governorate) params.set('governorate', governorate); if (status) params.set('status', status); void fetch(`/api/directory/buyers?${params}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }).then(async (response) => { const payload = await response.json() as { data?: unknown }; if (!response.ok || !Array.isArray(payload.data)) throw new Error('directory'); setBuyers(payload.data as Buyer[]); setState('loaded'); }).catch((error: unknown) => { if (error instanceof DOMException && error.name === 'AbortError') return; setState('error'); }); return () => controller.abort(); }, [governorate, material, role, run, status]);
  if (role !== 'owner') return <PageContainer><StatePanel title={ar.state.forbiddenTitle} description={ar.directory.centralNotice} tone="warning" /></PageContainer>;
  function apply(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setRun((value) => value + 1); }
  return <PageContainer width="wide"><PageHeader title={ar.directory.title} description={ar.directory.description} /><StatePanel title={ar.directory.centralNotice} description={ar.directory.noCentralPhoneHint} />
    <Section title={ar.directory.filtersTitle}><form className="operations-form" onSubmit={apply}><FormField id="directory-material" label={ar.directory.materialLabel}><TextInput value={material} onChange={(event) => setMaterial(event.target.value)} placeholder={ar.directory.materialPlaceholder} /></FormField><FormField id="directory-governorate" label={ar.directory.governorateLabel}><TextInput value={governorate} onChange={(event) => setGovernorate(event.target.value)} placeholder={ar.directory.governoratePlaceholder} /></FormField><FormField id="directory-status" label={ar.directory.statusLabel}><select className="text-input" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">{ar.directory.allOption}</option><option value="verified">{ar.directory.statusActive}</option><option value="unverified">{ar.directory.statusUnverified}</option><option value="stale">{ar.directory.statusOutdated}</option></select></FormField><div className="form-actions"><Button type="submit">{ar.directory.applyAction}</Button><Button variant="secondary" onClick={() => { setMaterial(''); setGovernorate(''); setStatus(''); setRun((value) => value + 1); }}>{ar.directory.resetAction}</Button></div></form></Section>
    {state === 'loading' ? <StatePanel title={ar.directory.loadingTitle} description={ar.directory.description} /> : null}{state === 'error' ? <StatePanel title={ar.directory.unavailableTitle} description={ar.directory.unavailableDescription} tone="danger" /> : null}{state === 'loaded' && buyers.length === 0 ? <StatePanel title={ar.directory.emptyTitle} description={ar.directory.emptyDescription} /> : null}
    {buyers.length ? <Section title={`${ar.directory.resultsTitle} (${buyers.length})`}><div className="directory-grid">{buyers.map((buyer) => <article className="directory-card" key={buyer.id}><div className="directory-card__header"><div><h3>{buyer.name}</h3><p>{entityLabel(buyer.entity_type)}</p></div><StatusBadge label={statusLabel(buyer.status)} tone={buyer.status === 'verified' ? 'success' : buyer.status === 'stale' ? 'warning' : 'neutral'} /></div><p>{buyer.governorates.join(ar.directory.listSeparator)} · {ar.directory.logistics[buyer.logistics]}</p><p>{buyer.materials?.map((item) => item.material_grade ? `${item.material_type} (${item.material_grade})` : item.material_type).join(ar.directory.listSeparator) || ar.directory.emptyValue}</p><div className="directory-card__actions">{buyer.phone ? <a href={`tel:${buyer.phone}`}>{ar.directory.callAction}</a> : <span>{ar.directory.noPhone}</span>}<Link href={`/directory/${encodeURIComponent(buyer.id)}`} prefetch={false}>{ar.directory.viewAction}</Link></div></article>)}</div></Section> : null}
  </PageContainer>;
}
