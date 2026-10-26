'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { ar } from '../copy/ar';
import { apiErrorMessage } from '../clientSecurity';
import { useResilientSubmit, loadDraft, saveDraftWithIntent, formKeyOf } from '../offline/useResilientSubmit';
import { Amount } from './Amount';
import { Button } from './Button';
import { FormActions } from './FormActions';
import { FormField } from './FormField';
import { PageContainer } from './PageContainer';
import { PageHeader } from './PageHeader';
import { Section } from './Section';
import { StatePanel } from './StatePanel';
import { TextInput } from './TextInput';

export type EntryType = 'purchase' | 'sale';
type PriceUnit = 'kg' | 'ton';
type DeductionType = 'none' | 'percent' | 'kg';

export interface TransactionMaterial {
  readonly id: string;
  readonly display_name: string;
  readonly default_pricing_unit: PriceUnit;
  readonly ref_buy_price: string | null;
  readonly ref_sell_price: string | null;
}

interface Party {
  readonly id: string;
  readonly name: string | null;
  readonly phone: string | null;
}

interface DraftLine {
  readonly id: string;
  readonly material_id: string;
  readonly gross_kg: string;
  readonly deduction_type: DeductionType;
  readonly deduction_value: string;
  readonly unit_price: string;
  readonly price_unit: PriceUnit;
}

interface PostedResult {
  readonly id: string;
  readonly number: string | null;
  readonly status: 'posted' | 'pending_stock_resolution';
  readonly total_amount: string;
}

type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly materials: readonly TransactionMaterial[]; readonly parties: readonly Party[] }
  | { readonly status: 'error' };

function cairoBusinessDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    calendar: 'gregory', timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function blankLine(id: string): DraftLine {
  return {
    id, material_id: '', gross_kg: '', deduction_type: 'none', deduction_value: '0', unit_price: '', price_unit: 'kg',
  };
}

function titleFor(type: EntryType): string {
  return type === 'purchase' ? ar.transactionEntry.purchaseTitle : ar.transactionEntry.saleTitle;
}

function descriptionFor(type: EntryType): string {
  return type === 'purchase' ? ar.transactionEntry.purchaseDescription : ar.transactionEntry.saleDescription;
}

function saveLabelFor(type: EntryType): string {
  return type === 'purchase' ? ar.transactionEntry.savePurchaseAction : ar.transactionEntry.saveSaleAction;
}

/**
 * A deliberate material switch gets a fresh reference default. In particular,
 * a missing reference clears rather than inherits the previous material price.
 */
export function materialSelectionPatch(
  type: EntryType,
  materialId: string,
  material: TransactionMaterial | undefined,
): Partial<Omit<DraftLine, 'id'>> {
  const reference = material ? (type === 'purchase' ? material.ref_buy_price : material.ref_sell_price) : null;
  return {
    material_id: materialId,
    ...(material ? { price_unit: material.default_pricing_unit } : {}),
    unit_price: reference ?? '',
  };
}

/**
 * A real-entry form: it keeps raw input only until submit and never derives or
 * displays a client-calculated weight/price/total. The server remains the single
 * financial calculator and posting authority.
 */
export function TransactionEntryContent({ type, scope = null }: { readonly type: EntryType; readonly scope?: string | null }) {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [businessDate, setBusinessDate] = useState(cairoBusinessDate);
  const [partyId, setPartyId] = useState('');
  const [amountCash, setAmountCash] = useState('0.00');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<readonly DraftLine[]>([blankLine('line-0')]);
  const [nextLineNumber, setNextLineNumber] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PostedResult | null>(null);
  const [replayNote, setReplayNote] = useState(false);
  // مفتاح العزم وطابع الجهاز محفوظان داخل الخطّاف عبر ref — محاولة أخرى (أو
  // إعادة فتح بعد موت) تبعث بنفسهما حرفيًا (ADR-0016: مرة واحدة بالضبط).
  const { submit: resilientSubmit, submitting, outcome, intentState } = useResilientSubmit(type, scope);
  const [draftRestored, setDraftRestored] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetch('/api/materials', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }),
      fetch('/api/parties', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }),
    ])
      .then(async ([materialsResponse, partiesResponse]) => {
        if (!materialsResponse.ok || !partiesResponse.ok) throw new Error('references_unavailable');
        const materialsPayload = await materialsResponse.json() as { data?: unknown };
        const partiesPayload = await partiesResponse.json() as { data?: unknown };
        if (!Array.isArray(materialsPayload.data) || !Array.isArray(partiesPayload.data)) throw new Error('references_shape');
        setLoadState({
          status: 'ready', materials: materialsPayload.data as TransactionMaterial[], parties: partiesPayload.data as Party[],
        });
      })
      .catch((failure: unknown) => {
        if (failure instanceof DOMException && failure.name === 'AbortError') return;
        setLoadState({ status: 'error' });
      });
    return () => controller.abort();
  }, []);

  function updateLine(id: string, patch: Partial<Omit<DraftLine, 'id'>>) {
    setLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line));
  }

  function selectMaterial(id: string, materialId: string) {
    const material = loadState.status === 'ready'
      ? loadState.materials.find((item) => item.id === materialId)
      : undefined;
    updateLine(id, materialSelectionPatch(type, materialId, material));
  }

  function addLine() {
    const id = `line-${nextLineNumber}`;
    setLines((current) => [...current, blankLine(id)]);
    setNextLineNumber((current) => current + 1);
  }

  function removeLine(id: string) {
    setLines((current) => current.length > 1 ? current.filter((line) => line.id !== id) : current);
  }

  // المسودة المحلية (PWA_RULES 4): تُستعاد مرة واحدة بعد معرفة النطاق، وتُحفظ
  // بترقّق 500ms عند كل تغيير — إغلاق/موت جهاز لا يضيّع فرزًا ناقصًا أبدًا.
  useEffect(() => {
    if (!scope || draftRestored) return;
    setDraftRestored(true);
    void loadDraft(scope, formKeyOf(type)).then((fields) => {
      if (!fields) return;
      if (typeof fields.businessDate === 'string') setBusinessDate(fields.businessDate);
      if (typeof fields.partyId === 'string') setPartyId(fields.partyId);
      if (typeof fields.amountCash === 'string') setAmountCash(fields.amountCash);
      if (typeof fields.note === 'string') setNote(fields.note);
      if (Array.isArray(fields.lines) && fields.lines.length > 0) {
        const restored = fields.lines as unknown as DraftLine[];
        if (restored.every((line) => typeof line === 'object' && line && typeof (line as DraftLine).id === 'string')) {
          setLines(restored);
          setNextLineNumber(restored.length);
        }
      }
    });
  }, [scope, draftRestored, type]);

  useEffect(() => {
    if (!scope || !draftRestored || result) return;
    const timer = window.setTimeout(() => {
      void saveDraftWithIntent(scope, formKeyOf(type), { businessDate, partyId, amountCash, note, lines });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [scope, draftRestored, type, businessDate, partyId, amountCash, note, lines, result]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loadState.status !== 'ready' || submitting || result) return;
    setError(null);
    // النية تُسجَّل محليًا بمفتاحها قبل أول إرسال؛ عند الانقطاع تبقى مرئية
    // بصدق («لم تُرسل») وتُستأنف بنفس المفتاح — لا إيصال ولا رصيد قبل الإقرار.
    const outcomeResult = await resilientSubmit({
      business_date: businessDate,
      lines: lines.map(({ id: _id, ...line }) => line),
      amount_cash: amountCash,
      ...(partyId ? { party_id: partyId } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    if (!outcomeResult) {
      setError(ar.transactionEntry.materialsUnavailableDescription);
      return;
    }
    if (outcomeResult.kind === 'acknowledged') {
      const posted = outcomeResult.payload as Partial<PostedResult>;
      if (typeof posted.id !== 'string' || typeof posted.total_amount !== 'string'
        || (posted.status !== 'posted' && posted.status !== 'pending_stock_resolution')) {
        setError(apiErrorMessage(null) ?? ar.transactionEntry.materialsUnavailableDescription);
        return;
      }
      setResult({
        id: posted.id,
        number: typeof posted.number === 'string' ? posted.number : null,
        status: posted.status,
        total_amount: posted.total_amount,
      });
      setReplayNote(outcomeResult.idempotentReplay);
      return;
    }
    if (outcomeResult.kind === 'conflict') {
      // تعارض صريح (يوم مقفول/رصيد متغيّر/مرجع بالٍ): لا توليد ولا رصيد —
      // نصّ الخادم العربي يُعرض كما هو والمسودة محفوظة للمعالجة.
      setError(`${ar.offline.conflictPrefix} ${outcomeResult.message}`);
      return;
    }
    if (outcomeResult.kind === 'parked') {
      setError(outcomeResult.message);
    }
    // queued: لا رسالة خطأ — شريط الحالة والراية الصادقة أسفل النموذج يكفيان.
  }

  if (loadState.status === 'loading') {
    return <PageContainer><StatePanel description={ar.transactionEntry.loadingMaterialsDescription} title={ar.transactionEntry.loadingMaterialsTitle} /></PageContainer>;
  }
  if (loadState.status === 'error') {
    return <PageContainer><StatePanel description={ar.transactionEntry.materialsUnavailableDescription} title={ar.transactionEntry.materialsUnavailableTitle} tone="warning" /></PageContainer>;
  }
  if (loadState.materials.length === 0) {
    return (
      <PageContainer>
        <StatePanel
          action={<Link className="ui-button ui-button--primary ui-button--md" href="/materials">{ar.transactionEntry.setupMaterialsAction}</Link>}
          description={ar.transactionEntry.noMaterialsDescription}
          title={ar.transactionEntry.noMaterialsTitle}
          tone="warning"
        />
      </PageContainer>
    );
  }
  if (result) {
    const pending = result.status === 'pending_stock_resolution';
    return (
      <PageContainer width="form">
        {replayNote ? <p className="offline-outcome" role="status">{ar.offline.replayedNote}</p> : null}
        <StatePanel
          action={(
            <div className="transaction-result__actions">
              {!pending && result.number ? (
                <Link className="ui-button ui-button--primary ui-button--md" href={`/transactions/${encodeURIComponent(result.id)}/receipt`}>
                  {ar.receipt.viewAction}
                </Link>
              ) : null}
              <Link className="ui-button ui-button--secondary ui-button--md" href={`/transactions/${encodeURIComponent(result.id)}`}>
                {ar.transactionEntry.viewTransactionAction}
              </Link>
              <Link className="ui-link" href="/today">{ar.transactionEntry.backToToday}</Link>
            </div>
          )}
          description={ar.transactionEntry.savedDescription}
          headingLevel={1}
          title={pending ? ar.transactionEntry.pendingStockTitle : ar.transactionEntry.savedTitle}
          tone={pending ? 'warning' : 'info'}
        />
        <Section title={ar.transactionEntry.submittedTotalLabel} tone="outlined">
          <p className="transaction-result__amount"><Amount emphasis value={result.total_amount} /></p>
          <p className="transaction-result__number"><bdi dir="ltr">{result.number ?? ar.transactionEntry.noNumber}</bdi></p>
        </Section>
      </PageContainer>
    );
  }

  return (
    <PageContainer width="wide">
      <PageHeader backHref="/today" backLabel={ar.transactionEntry.backToToday} description={descriptionFor(type)} title={titleFor(type)} />
        {intentState === 'resuming' ? <p className="offline-outcome" role="status">{ar.intentBanners.resuming}</p> : null}
        {intentState === 'hasQueued' ? <p className="offline-outcome" role="status">{ar.intentBanners.hasQueued}</p> : null}
      <form className="transaction-entry" onSubmit={submit}>
        <Section title={titleFor(type)}>
          <div className="transaction-entry__top-fields">
            <FormField id="transaction-business-date" label={ar.transactionEntry.businessDateLabel} required>
              <TextInput name="business_date" onChange={(event) => setBusinessDate(event.target.value)} required type="date" value={businessDate} />
            </FormField>
            <FormField
              action={<Link className="ui-link" href="/parties">{ar.parties.addAction}</Link>}
              id="transaction-party"
              label={ar.transactionEntry.partyLabel}
            >
              <select className="text-input" name="party_id" onChange={(event) => setPartyId(event.target.value)} value={partyId}>
                <option value="">{ar.transactionEntry.partyPlaceholder}</option>
                {loadState.parties.map((party) => (
                  <option key={party.id} value={party.id}>{party.name ?? party.phone}</option>
                ))}
              </select>
            </FormField>
            <FormField id="transaction-amount-cash" label={ar.transactionEntry.cashAmountLabel} required>
              <TextInput inputMode="decimal" name="amount_cash" onChange={(event) => setAmountCash(event.target.value)} required type="text" value={amountCash} />
            </FormField>
          </div>
          <p className="transaction-entry__notice" role="status">{ar.transactionEntry.serverCalculationNotice}</p>
        </Section>

        <Section action={<Button onClick={addLine} type="button" variant="secondary">{ar.transactionEntry.addLineAction}</Button>} title={ar.transactionEntry.materialLabel}>
          <div className="transaction-entry__lines">
            {lines.map((line, index) => (
              <fieldset className="transaction-entry__line" key={line.id}>
                <legend className="visually-hidden">{ar.transactionEntry.materialLabel} <bdi dir="ltr">{index + 1}</bdi></legend>
                <FormField id={`${line.id}-material`} label={ar.transactionEntry.materialLabel} required>
                  <select className="text-input" name={`${line.id}-material`} onChange={(event) => selectMaterial(line.id, event.target.value)} required value={line.material_id}>
                    <option value="">{ar.transactionEntry.materialPlaceholder}</option>
                    {loadState.materials.map((material) => <option key={material.id} value={material.id}>{material.display_name}</option>)}
                  </select>
                </FormField>
                <FormField id={`${line.id}-gross`} label={ar.transactionEntry.grossWeightLabel} required>
                  <TextInput inputMode="decimal" name={`${line.id}-gross`} onChange={(event) => updateLine(line.id, { gross_kg: event.target.value })} required type="text" value={line.gross_kg} />
                </FormField>
                <FormField id={`${line.id}-deduction-type`} label={ar.transactionEntry.deductionTypeLabel} required>
                  <select className="text-input" name={`${line.id}-deduction-type`} onChange={(event) => updateLine(line.id, { deduction_type: event.target.value as DeductionType })} value={line.deduction_type}>
                    <option value="none">{ar.transactionEntry.deductionNone}</option>
                    <option value="percent">{ar.transactionEntry.deductionPercent}</option>
                    <option value="kg">{ar.transactionEntry.deductionKilogram}</option>
                  </select>
                </FormField>
                <FormField id={`${line.id}-deduction-value`} label={ar.transactionEntry.deductionValueLabel} required>
                  <TextInput disabled={line.deduction_type === 'none'} inputMode="decimal" name={`${line.id}-deduction-value`} onChange={(event) => updateLine(line.id, { deduction_value: event.target.value })} required type="text" value={line.deduction_value} />
                </FormField>
                <FormField id={`${line.id}-price`} label={ar.transactionEntry.unitPriceLabel} required>
                  <TextInput inputMode="decimal" name={`${line.id}-price`} onChange={(event) => updateLine(line.id, { unit_price: event.target.value })} required type="text" value={line.unit_price} />
                </FormField>
                <FormField id={`${line.id}-price-unit`} label={ar.transactionEntry.priceUnitLabel} required>
                  <select className="text-input" name={`${line.id}-price-unit`} onChange={(event) => updateLine(line.id, { price_unit: event.target.value as PriceUnit })} value={line.price_unit}>
                    <option value="kg">{ar.units.kilogram}</option>
                    <option value="ton">{ar.units.ton}</option>
                  </select>
                </FormField>
                {lines.length > 1 ? <Button onClick={() => removeLine(line.id)} type="button" variant="tertiary">{ar.transactionEntry.removeLineAction}</Button> : null}
              </fieldset>
            ))}
          </div>
        </Section>

        <Section title={ar.transactionEntry.noteLabel} tone="plain">
          <FormField hint={ar.transactionEntry.noteHint} id="transaction-note" label={ar.transactionEntry.noteLabel}>
            <TextInput maxLength={1000} name="note" onChange={(event) => setNote(event.target.value)} value={note} />
          </FormField>
        </Section>
        {outcome && outcome.kind === 'queued' ? (
          <p aria-live="polite" className="offline-outcome" role="status">{ar.offline.queuedPrefix} {outcome.message}</p>
        ) : null}
        <FormActions {...(error ? { status: error } : {})} stickyOnMobile>
          <Button loading={submitting} size="lg" type="submit">{submitting ? ar.transactionEntry.savingAction : saveLabelFor(type)}</Button>
        </FormActions>
      </form>
    </PageContainer>
  );
}
