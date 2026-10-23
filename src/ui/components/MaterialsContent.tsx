'use client';

import { useEffect, useState, type FormEvent } from 'react';

import { ar, type AppRole } from '../copy/ar';
import { requireInjectedRole } from '../requiredRole';
import { apiErrorMessage, ensureCsrfToken } from '../clientSecurity';
import { PriceWithUnit } from './Weight';
import { Button } from './Button';
import { FormActions } from './FormActions';
import { FormField } from './FormField';
import { PageContainer } from './PageContainer';
import { PageHeader } from './PageHeader';
import { Section } from './Section';
import { StatePanel } from './StatePanel';
import { TextInput } from './TextInput';

interface Material {
  readonly id: string;
  readonly type: string;
  readonly grade: string | null;
  readonly display_name: string;
  readonly default_pricing_unit: 'kg' | 'ton';
  readonly ref_buy_price: string | null;
  readonly ref_sell_price: string | null;
  readonly is_active: boolean;
  readonly is_favourite: boolean;
  readonly sort_order: number;
}

type MaterialsState =
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly data: readonly Material[] }
  | { readonly status: 'error' };

function unitLabel(unit: Material['default_pricing_unit']): string {
  return unit === 'kg' ? ar.materials.kilogramOption : ar.materials.tonOption;
}

/** Owner-only catalog management; authorization is enforced again by the API. */
export function MaterialsContent({ role: injectedRole }: { readonly role?: AppRole }) {
  const role = requireInjectedRole(injectedRole);
  const [state, setState] = useState<MaterialsState>({ status: 'loading' });
  const [showCreate, setShowCreate] = useState(false);
  const [type, setType] = useState('');
  const [grade, setGrade] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [pricingUnit, setPricingUnit] = useState<Material['default_pricing_unit']>('kg');
  const [refBuyPrice, setRefBuyPrice] = useState('');
  const [refSellPrice, setRefSellPrice] = useState('');
  const [favourite, setFavourite] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Material | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editBuyPrice, setEditBuyPrice] = useState('');
  const [editSellPrice, setEditSellPrice] = useState('');
  const [editFavourite, setEditFavourite] = useState(false);
  const [editActive, setEditActive] = useState(true);
  const [editIdempotencyKey, setEditIdempotencyKey] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [confirmDeactivation, setConfirmDeactivation] = useState(false);

  useEffect(() => {
    if (role !== 'owner') return;
    const controller = new AbortController();
    void fetch('/api/materials?include_inactive=true', {
      credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('materials_unavailable');
        const payload = await response.json() as { data?: unknown };
        if (!Array.isArray(payload.data)) throw new Error('materials_shape');
        setState({ status: 'loaded', data: payload.data as Material[] });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [role]);

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating || role !== 'owner') return;
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
      const response = await fetch('/api/materials', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'idempotency-key': key, 'x-kayyal-csrf': csrf },
        body: JSON.stringify({
          type: type.trim(),
          ...(grade.trim() ? { grade: grade.trim() } : {}),
          display_name: displayName.trim(),
          default_pricing_unit: pricingUnit,
          ...(refBuyPrice.trim() ? { ref_buy_price: refBuyPrice.trim() } : {}),
          ...(refSellPrice.trim() ? { ref_sell_price: refSellPrice.trim() } : {}),
          is_favourite: favourite,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !payload || typeof payload !== 'object') {
        setCreateError(apiErrorMessage(payload) ?? ar.materials.unavailableDescription);
        return;
      }
      const material = payload as Partial<Material>;
      if (!isMaterial(material)) throw new Error('material_shape');
      setState((current) => current.status === 'loaded'
        ? { status: 'loaded', data: [material, ...current.data] }
        : current);
      setType('');
      setGrade('');
      setDisplayName('');
      setPricingUnit('kg');
      setRefBuyPrice('');
      setRefSellPrice('');
      setFavourite(false);
      setIdempotencyKey(null);
      setShowCreate(false);
    } catch {
      setCreateError(ar.materials.unavailableDescription);
    } finally {
      setCreating(false);
    }
  }

  function beginEdit(material: Material) {
    if (updating) return;
    setShowCreate(false);
    setEditing(material);
    setEditDisplayName(material.display_name);
    setEditBuyPrice(material.ref_buy_price ?? '');
    setEditSellPrice(material.ref_sell_price ?? '');
    setEditFavourite(material.is_favourite);
    setEditActive(material.is_active);
    setEditIdempotencyKey(null);
    setEditError(null);
    setConfirmDeactivation(false);
  }

  function cancelEdit() {
    if (updating) return;
    setEditing(null);
    setEditError(null);
    setConfirmDeactivation(false);
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || updating || role !== 'owner') return;
    if (editing.is_active && !editActive && !confirmDeactivation) {
      setConfirmDeactivation(true);
      return;
    }
    const key = editIdempotencyKey ?? globalThis.crypto?.randomUUID();
    if (!key) {
      setEditError(ar.auth.csrfUnavailable);
      return;
    }
    setEditError(null);
    setUpdating(true);
    setEditIdempotencyKey(key);
    const csrf = await ensureCsrfToken();
    if (!csrf) {
      setEditError(ar.auth.csrfUnavailable);
      setUpdating(false);
      return;
    }
    try {
      const response = await fetch(`/api/materials/${encodeURIComponent(editing.id)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'idempotency-key': key, 'x-kayyal-csrf': csrf },
        body: JSON.stringify({
          display_name: editDisplayName.trim(),
          ref_buy_price: editBuyPrice.trim() || null,
          ref_sell_price: editSellPrice.trim() || null,
          is_favourite: editFavourite,
          is_active: editActive,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !payload || typeof payload !== 'object') {
        setEditError(apiErrorMessage(payload) ?? ar.materials.unavailableDescription);
        return;
      }
      const material = payload as Partial<Material>;
      if (!isMaterial(material)) throw new Error('material_shape');
      setState((current) => current.status === 'loaded'
        ? { status: 'loaded', data: current.data.map((item) => item.id === material.id ? material : item) }
        : current);
      setEditing(null);
      setEditIdempotencyKey(null);
      setConfirmDeactivation(false);
    } catch {
      setEditError(ar.materials.unavailableDescription);
    } finally {
      setUpdating(false);
    }
  }

  if (role !== 'owner') {
    return (
      <PageContainer>
        <PageHeader description={ar.materials.description} title={ar.materials.title} />
        <StatePanel description={ar.materials.forbiddenDescription} title={ar.materials.forbiddenTitle} tone="warning" />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader description={ar.materials.description} title={ar.materials.title} />
      {state.status === 'loading' ? <StatePanel description={ar.state.sessionCheckingDescription} title={ar.common.loading} /> : null}
      {state.status === 'error' ? <StatePanel description={ar.materials.unavailableDescription} title={ar.materials.unavailableTitle} tone="warning" /> : null}
      {state.status === 'loaded' ? (
        <Section action={<Button aria-controls="material-create-form" aria-expanded={showCreate} onClick={() => { setEditing(null); setShowCreate((visible) => !visible); }} type="button" variant="secondary">{ar.materials.addAction}</Button>} title={ar.materials.title}>
          {showCreate ? (
            <form className="material-create-form" id="material-create-form" onSubmit={submitCreate}>
              <FormField id="material-type" label={ar.materials.typeLabel} required>
                <TextInput maxLength={60} name="type" onChange={(event) => setType(event.target.value)} required value={type} />
              </FormField>
              <FormField id="material-grade" label={ar.materials.gradeLabel}>
                <TextInput maxLength={60} name="grade" onChange={(event) => setGrade(event.target.value)} value={grade} />
              </FormField>
              <FormField id="material-display-name" label={ar.materials.displayNameLabel} required>
                <TextInput maxLength={160} name="display-name" onChange={(event) => setDisplayName(event.target.value)} required value={displayName} />
              </FormField>
              <FormField id="material-pricing-unit" label={ar.materials.pricingUnitLabel} required>
                <select className="text-input" name="pricing-unit" onChange={(event) => setPricingUnit(event.target.value as Material['default_pricing_unit'])} value={pricingUnit}>
                  <option value="kg">{ar.materials.kilogramOption}</option>
                  <option value="ton">{ar.materials.tonOption}</option>
                </select>
              </FormField>
              <FormField id="material-buy-price" label={ar.materials.refBuyPriceLabel}>
                <TextInput inputMode="decimal" maxLength={30} name="buy-price" onChange={(event) => setRefBuyPrice(event.target.value)} value={refBuyPrice} />
              </FormField>
              <FormField id="material-sell-price" label={ar.materials.refSellPriceLabel}>
                <TextInput inputMode="decimal" maxLength={30} name="sell-price" onChange={(event) => setRefSellPrice(event.target.value)} value={refSellPrice} />
              </FormField>
              <label className="checkbox-field">
                <input checked={favourite} name="favourite" onChange={(event) => setFavourite(event.target.checked)} type="checkbox" />
                <span>{ar.materials.favouriteLabel}</span>
              </label>
              <FormActions {...(createError ? { status: createError } : {})}>
                <Button loading={creating} type="submit">{creating ? ar.materials.savingAction : ar.materials.saveAction}</Button>
              </FormActions>
            </form>
          ) : null}
          {editing ? (
            <form className="material-edit-form" onSubmit={submitEdit}>
              <p className="material-edit-form__identity">
                {[editing.type, editing.grade, unitLabel(editing.default_pricing_unit)].filter(Boolean).join(' · ')}
              </p>
              <FormField id="edit-material-display-name" label={ar.materials.displayNameLabel} required>
                <TextInput maxLength={160} name="display-name" onChange={(event) => setEditDisplayName(event.target.value)} required value={editDisplayName} />
              </FormField>
              <FormField id="edit-material-buy-price" label={ar.materials.refBuyPriceLabel}>
                <TextInput inputMode="decimal" maxLength={30} name="buy-price" onChange={(event) => setEditBuyPrice(event.target.value)} value={editBuyPrice} />
              </FormField>
              <FormField id="edit-material-sell-price" label={ar.materials.refSellPriceLabel}>
                <TextInput inputMode="decimal" maxLength={30} name="sell-price" onChange={(event) => setEditSellPrice(event.target.value)} value={editSellPrice} />
              </FormField>
              <label className="checkbox-field">
                <input checked={editFavourite} name="favourite" onChange={(event) => setEditFavourite(event.target.checked)} type="checkbox" />
                <span>{ar.materials.favouriteLabel}</span>
              </label>
              <label className="checkbox-field">
                <input checked={editActive} name="active" onChange={(event) => { setEditActive(event.target.checked); if (event.target.checked) setConfirmDeactivation(false); }} type="checkbox" />
                <span>{ar.materials.activeLabel}</span>
              </label>
              {confirmDeactivation ? (
                <StatePanel description={ar.materials.deactivateConfirmation} title={ar.materials.deactivateTitle} tone="warning" />
              ) : null}
              <FormActions {...(editError ? { status: editError } : {})}>
                <Button loading={updating} type="submit">
                  {updating ? ar.materials.savingAction : confirmDeactivation ? ar.materials.confirmDeactivateAction : ar.materials.saveChangesAction}
                </Button>
                <Button disabled={updating} onClick={cancelEdit} type="button" variant="secondary">{ar.materials.cancelAction}</Button>
              </FormActions>
            </form>
          ) : null}
          {state.data.length === 0 ? (
            <StatePanel description={ar.materials.noMaterialsDescription} title={ar.materials.noMaterialsTitle} />
          ) : (
            <ul className="materials-list">
              {state.data.map((material) => (
                <li className="materials-list__item" key={material.id}>
                  <div className="materials-list__primary">
                    <strong>{material.display_name}</strong>
                    <span>{[material.type, material.grade].filter(Boolean).join(' · ')}</span>
                  </div>
                  <div className="materials-list__facts">
                    <span>{unitLabel(material.default_pricing_unit)}</span>
                    {material.ref_buy_price ? <span><span>{ar.materials.refBuyPriceLabel}</span><PriceWithUnit unit={material.default_pricing_unit} value={material.ref_buy_price} /></span> : null}
                    {material.ref_sell_price ? <span><span>{ar.materials.refSellPriceLabel}</span><PriceWithUnit unit={material.default_pricing_unit} value={material.ref_sell_price} /></span> : null}
                    <span>{material.is_active ? ar.status.active : ar.status.inactive}</span>
                    <Button disabled={updating} onClick={() => beginEdit(material)} size="sm" type="button" variant="secondary">{ar.materials.editAction}</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}
    </PageContainer>
  );
}

function isMaterial(value: Partial<Material>): value is Material {
  return typeof value.id === 'string'
    && typeof value.type === 'string'
    && (typeof value.grade === 'string' || value.grade === null)
    && typeof value.display_name === 'string'
    && (value.default_pricing_unit === 'kg' || value.default_pricing_unit === 'ton')
    && (typeof value.ref_buy_price === 'string' || value.ref_buy_price === null)
    && (typeof value.ref_sell_price === 'string' || value.ref_sell_price === null)
    && typeof value.is_active === 'boolean'
    && typeof value.is_favourite === 'boolean'
    && typeof value.sort_order === 'number';
}
