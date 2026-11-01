'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { ar, type AppRole } from '../copy/ar';
import { requireInjectedRole } from '../requiredRole';
import { apiErrorMessage, ensureCsrfToken } from '../clientSecurity';
import { Button } from './Button';
import { FormActions } from './FormActions';
import { FormField } from './FormField';
import { PageContainer } from './PageContainer';
import { PageHeader } from './PageHeader';
import { Section } from './Section';
import { StatePanel } from './StatePanel';
import { TextInput } from './TextInput';

interface Party {
  readonly id: string;
  readonly name: string | null;
  readonly phone: string | null;
  readonly kind: 'supplier' | 'customer' | 'both';
}

type PartiesState =
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly data: readonly Party[] }
  | { readonly status: 'error' };

function kindLabel(kind: Party['kind']): string {
  if (kind === 'supplier') return ar.parties.supplier;
  if (kind === 'customer') return ar.parties.customer;
  return ar.parties.both;
}

export function PartiesContent({ role: injectedRole }: { readonly role?: AppRole }) {
  const role = requireInjectedRole(injectedRole);
  const [state, setState] = useState<PartiesState>({ status: 'loading' });
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [kind, setKind] = useState<Party['kind']>('both');
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/parties', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('parties_unavailable');
        const payload = await response.json() as { data?: unknown };
        if (!Array.isArray(payload.data)) throw new Error('parties_shape');
        setState({ status: 'loaded', data: payload.data as Party[] });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({ status: 'error' });
      });
    return () => controller.abort();
  }, []);

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    const key = idempotencyKey ?? globalThis.crypto?.randomUUID();
    if (!key) {
      setCreateError(ar.auth.csrfUnavailable);
      return;
    }
    setCreateError(null);
    setCreating(true);
    setIdempotencyKey(key);
    const csrf = await ensureCsrfToken();
    if (!csrf) {
      setCreateError(ar.auth.csrfUnavailable);
      setCreating(false);
      return;
    }
    try {
      const response = await fetch('/api/parties', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'idempotency-key': key, 'x-kayyal-csrf': csrf },
        body: JSON.stringify({
          ...(name.trim() ? { name: name.trim() } : {}),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          kind,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !payload || typeof payload !== 'object') {
        setCreateError(apiErrorMessage(payload) ?? ar.parties.unavailableDescription);
        return;
      }
      const party = payload as Partial<Party>;
      if (typeof party.id !== 'string' || (party.kind !== 'supplier' && party.kind !== 'customer' && party.kind !== 'both')) {
        throw new Error('party_shape');
      }
      const created: Party = {
        id: party.id,
        name: typeof party.name === 'string' ? party.name : null,
        phone: typeof party.phone === 'string' ? party.phone : null,
        kind: party.kind,
      };
      setState((current) => current.status === 'loaded' ? { status: 'loaded', data: [created, ...current.data] } : current);
      setName('');
      setPhone('');
      setKind('both');
      setIdempotencyKey(null);
      setShowCreate(false);
    } catch {
      setCreateError(ar.parties.unavailableDescription);
    } finally {
      setCreating(false);
    }
  }

  return (
    <PageContainer>
      <PageHeader description={ar.parties.description} title={ar.parties.title} />
      {state.status === 'loading' ? <StatePanel description={ar.state.sessionCheckingDescription} title={ar.common.loading} /> : null}
      {state.status === 'error' ? <StatePanel description={ar.parties.unavailableDescription} title={ar.parties.unavailableTitle} tone="warning" /> : null}
      {state.status === 'loaded' ? (
        <Section action={<Button aria-controls="party-create-form" aria-expanded={showCreate} onClick={() => setShowCreate((visible) => !visible)} type="button" variant="secondary">{ar.parties.addAction}</Button>} title={ar.parties.title}>
          {showCreate ? (
            <form className="party-create-form" id="party-create-form" onSubmit={submitCreate}>
              <FormField id="party-name" label={ar.parties.nameLabel}>
                <TextInput maxLength={160} name="name" onChange={(event) => setName(event.target.value)} value={name} />
              </FormField>
              <FormField id="party-phone" label={ar.parties.phoneLabel}>
                <TextInput inputMode="tel" maxLength={40} name="phone" onChange={(event) => setPhone(event.target.value)} type="tel" value={phone} />
              </FormField>
              <FormField id="party-kind" label={ar.parties.kindLabel} required>
                <select className="text-input" name="kind" onChange={(event) => setKind(event.target.value as Party['kind'])} value={kind}>
                  <option value="supplier">{ar.parties.supplier}</option>
                  <option value="customer">{ar.parties.customer}</option>
                  <option value="both">{ar.parties.both}</option>
                </select>
              </FormField>
              <FormActions {...(createError ? { status: createError } : {})}>
                <Button loading={creating} type="submit">{creating ? ar.parties.savingAction : ar.parties.saveAction}</Button>
              </FormActions>
            </form>
          ) : null}
          {state.data.length === 0 ? (
            <StatePanel description={ar.parties.noPartiesDescription} title={ar.parties.noPartiesTitle} />
          ) : (
            <ul className="operational-list">
              {state.data.map((party) => (
                <li className="operational-list__item" key={party.id}>
                  <div className="operational-list__primary">
                    <strong>{party.name ?? party.phone}</strong>
                    {party.name && party.phone ? <span><bdi dir="ltr">{party.phone}</bdi></span> : null}
                  </div>
                  <span>{kindLabel(party.kind)}</span>
                  {role === 'owner' ? (
                    <Link prefetch={false} className="ui-link" href={`/parties/${encodeURIComponent(party.id)}`}>
                      {ar.parties.viewLedgerAction}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}
    </PageContainer>
  );
}
