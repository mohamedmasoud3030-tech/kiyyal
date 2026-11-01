'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ar, type AppRole } from '../copy/ar';
import { requireInjectedRole } from '../requiredRole';
import { Amount } from './Amount';
import { PageContainer } from './PageContainer';
import { PageHeader } from './PageHeader';
import { Section } from './Section';
import { StatePanel } from './StatePanel';

type PartyKind = 'supplier' | 'customer' | 'both';
type BalanceDirection = 'owed_by_party' | 'owed_to_party' | 'settled';
type EventType = 'purchase' | 'sale' | 'payment';

interface PartyLedgerEvent {
  readonly id: string;
  readonly type: EventType;
  readonly number: string | null;
  readonly business_date: string;
  readonly created_at: string;
  readonly amount: string;
  readonly balance_delta: string;
  readonly balance_after: string;
  readonly payment_direction: 'in' | 'out' | null;
  readonly note: string | null;
}

interface PartyLedger {
  readonly id: string;
  readonly name: string | null;
  readonly phone: string | null;
  readonly kind: PartyKind;
  readonly is_active: boolean;
  readonly balance_amount: string;
  readonly balance_direction: BalanceDirection;
  readonly events: readonly PartyLedgerEvent[];
}

type LedgerState =
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly data: PartyLedger }
  | { readonly status: 'error' };

function validEventType(value: unknown): value is EventType {
  return value === 'purchase' || value === 'sale' || value === 'payment';
}

function isPartyLedgerEvent(value: unknown): value is PartyLedgerEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return typeof event.id === 'string'
    && validEventType(event.type)
    && (typeof event.number === 'string' || event.number === null)
    && typeof event.business_date === 'string'
    && typeof event.created_at === 'string'
    && typeof event.amount === 'string'
    && typeof event.balance_delta === 'string'
    && typeof event.balance_after === 'string'
    && (event.payment_direction === 'in' || event.payment_direction === 'out' || event.payment_direction === null)
    && (typeof event.note === 'string' || event.note === null);
}

function isPartyLedger(value: unknown): value is PartyLedger {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return typeof data.id === 'string'
    && (typeof data.name === 'string' || data.name === null)
    && (typeof data.phone === 'string' || data.phone === null)
    && (data.kind === 'supplier' || data.kind === 'customer' || data.kind === 'both')
    && typeof data.is_active === 'boolean'
    && typeof data.balance_amount === 'string'
    && (data.balance_direction === 'owed_by_party' || data.balance_direction === 'owed_to_party' || data.balance_direction === 'settled')
    && Array.isArray(data.events)
    && data.events.every(isPartyLedgerEvent);
}

function kindLabel(kind: PartyKind): string {
  if (kind === 'supplier') return ar.parties.supplier;
  if (kind === 'customer') return ar.parties.customer;
  return ar.parties.both;
}

function balanceLabel(direction: BalanceDirection): string {
  if (direction === 'owed_by_party') return ar.partyLedger.owedByParty;
  if (direction === 'owed_to_party') return ar.partyLedger.owedToParty;
  return ar.partyLedger.settled;
}

function balanceDirectionFor(signedAmount: string): BalanceDirection {
  // The server schema permits canonical decimal strings only. Sign and a
  // non-zero digit are sufficient here; parsing money in the display layer is not.
  const nonZero = /[1-9]/.test(signedAmount);
  if (!nonZero) return 'settled';
  return signedAmount.startsWith('-') ? 'owed_to_party' : 'owed_by_party';
}

function absoluteAmount(signedAmount: string): string {
  return signedAmount.startsWith('-') ? signedAmount.slice(1) : signedAmount;
}

function eventTitle(event: PartyLedgerEvent): string {
  if (event.type === 'payment') return event.payment_direction === 'out' ? ar.partyLedger.paymentOut : ar.partyLedger.paymentIn;
  return ar.history.typeLabels[event.type];
}

/**
 * A bounded chronological ledger suits the owner's reconciliation task better
 * than a compressed table. Its endpoint is owner-only; this component also
 * fails closed before fetching if it is rendered under another role.
 */
export function PartyLedgerContent({ partyId, role: injectedRole }: { readonly partyId: string; readonly role?: AppRole }) {
  const role = requireInjectedRole(injectedRole);
  const [state, setState] = useState<LedgerState>({ status: 'loading' });

  useEffect(() => {
    if (role !== 'owner') return;
    const controller = new AbortController();
    void fetch(`/api/parties/${encodeURIComponent(partyId)}`, {
      credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('party_ledger_unavailable');
        const payload: unknown = await response.json();
        if (!isPartyLedger(payload)) throw new Error('party_ledger_shape');
        setState({ status: 'loaded', data: payload });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [partyId, role]);

  if (role !== 'owner') {
    return (
      <PageContainer>
        <StatePanel description={ar.state.forbiddenDescription} headingLevel={1} title={ar.state.forbiddenTitle} tone="warning" />
      </PageContainer>
    );
  }

  if (state.status === 'loading') {
    return <PageContainer><StatePanel description={ar.state.sessionCheckingDescription} headingLevel={1} title={ar.common.loading} /></PageContainer>;
  }
  if (state.status === 'error') {
    return <PageContainer><StatePanel description={ar.partyLedger.unavailableDescription} headingLevel={1} title={ar.partyLedger.unavailableTitle} tone="warning" /></PageContainer>;
  }

  const party = state.data;
  return (
    <PageContainer>
      <PageHeader
        action={<Link prefetch={false} className="ui-link" href="/parties">{ar.partyLedger.backToParties}</Link>}
        description={ar.partyLedger.description}
        eyebrow={kindLabel(party.kind)}
        title={party.name ?? party.phone ?? ar.partyLedger.title}
      />
      <Section action={<Link prefetch={false} className="ui-button ui-button--primary ui-button--md" href={`/payment?party=${encodeURIComponent(party.id)}`}>{ar.partyLedger.paymentAction}</Link>} title={ar.partyLedger.balanceTitle} tone="muted">
        <dl className="party-ledger__balance">
          <div>
            <dt>{balanceLabel(party.balance_direction)}</dt>
            <dd><Amount emphasis value={party.balance_amount} /></dd>
          </div>
          <div>
            <dt>{ar.parties.kindLabel}</dt>
            <dd>{kindLabel(party.kind)}</dd>
          </div>
        </dl>
      </Section>
      <Section description={ar.partyLedger.eventsDescription} title={ar.partyLedger.eventsTitle}>
        {party.events.length === 0 ? (
          <StatePanel description={ar.partyLedger.noEventsDescription} title={ar.partyLedger.noEventsTitle} />
        ) : (
          <ol className="party-ledger__events">
            {party.events.map((event) => {
              const afterDirection = balanceDirectionFor(event.balance_after);
              return (
                <li className="party-ledger__event" key={event.id}>
                  <div className="party-ledger__event-primary">
                    <strong>{eventTitle(event)}</strong>
                    <span><bdi dir="ltr">{event.business_date}</bdi>{event.number ? ` · ${ar.today.transactionNumber} ${event.number}` : ''}</span>
                    {event.note ? <span>{event.note}</span> : null}
                  </div>
                  <dl className="party-ledger__event-facts">
                    <div>
                      <dt>{ar.partyLedger.amountLabel}</dt>
                      <dd><Amount value={event.amount} /></dd>
                    </div>
                    <div>
                      <dt>{ar.partyLedger.balanceAfterLabel} — {balanceLabel(afterDirection)}</dt>
                      <dd><Amount value={absoluteAmount(event.balance_after)} /></dd>
                    </div>
                  </dl>
                  <Link prefetch={false} className="operational-list__detail-link" href={`/transactions/${encodeURIComponent(event.id)}`}>
                    {ar.history.detailAction}
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </Section>
    </PageContainer>
  );
}
