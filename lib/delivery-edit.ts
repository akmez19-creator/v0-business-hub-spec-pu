/** Exact database fields used by the delivery edit dialog. No contact aliases. */
export const deliveryEditFields = ['delivery_date', 'contact_1', 'contact_2', 'locality', 'products', 'qty', 'notes'] as const
export type DeliveryEditField = typeof deliveryEditFields[number]
export type DeliveryEditPatch = Partial<Record<Exclude<DeliveryEditField, 'qty'>, string | null>> & { qty?: number }
export type DeliveryEditForm = Record<DeliveryEditField, string>
export type DeliveryEditSnapshot = {
  id: string
  updated_at: string | null
  delivery_date: string | null
  contact_1: string | null
  contact_2: string | null
  locality: string | null
  products: string | null
  qty: number
  notes: string | null
  status: string
  stock_out: boolean | null
  van_confirmed_by: string | null
  rescheduled_to: string | null
  reschedule_requested_to: string | null
}
export const deliveryEditGuardFields = ['updated_at', ...deliveryEditFields, 'status', 'stock_out', 'van_confirmed_by', 'rescheduled_to', 'reschedule_requested_to'] as const
export const deliveryEditSelect = ['id', ...deliveryEditGuardFields].join(',')

export function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function readDeliveryEditSnapshot(value: unknown): DeliveryEditSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Delivery details are incomplete. Reload before editing.')
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || !row.id || typeof row.status !== 'string' || !row.status ||
      !Number.isInteger(row.qty) || Number(row.qty) < 1 ||
      !(row.stock_out === null || typeof row.stock_out === 'boolean')) {
    throw new Error('Delivery details are incomplete. Reload before editing.')
  }
  for (const key of deliveryEditGuardFields) {
    if (key === 'qty' || key === 'stock_out' || key === 'status') continue
    if (!(row[key] === null || typeof row[key] === 'string')) throw new Error('Delivery details are incomplete. Reload before editing.')
  }
  for (const key of ['delivery_date', 'rescheduled_to', 'reschedule_requested_to'] as const) {
    if (row[key] !== null && !isDateOnly(row[key])) throw new Error('Delivery date format is unexpected. Reload before editing.')
  }
  const result = { id: row.id } as DeliveryEditSnapshot
  for (const key of deliveryEditGuardFields) Object.assign(result, { [key]: row[key] })
  return result
}

export function deliveryEditForm(snapshot: DeliveryEditSnapshot): DeliveryEditForm {
  return Object.fromEntries(deliveryEditFields.map(key => [key, snapshot[key] === null ? '' : String(snapshot[key])])) as DeliveryEditForm
}

/** Compare against the displayed original first: untouched whitespace/nulls never become writes. */
export function deliveryDirtyPatch(snapshot: DeliveryEditSnapshot, form: DeliveryEditForm): DeliveryEditPatch {
  const original = deliveryEditForm(snapshot)
  const patch: DeliveryEditPatch = {}
  for (const key of deliveryEditFields) {
    if (form[key] === original[key]) continue
    if (key === 'qty') patch.qty = Number(form.qty)
    else patch[key] = form[key].trim() || null
  }
  return validateDeliveryEditPatch(patch, snapshot)
}

export function canCorrectDeliveryDate(snapshot: DeliveryEditSnapshot): boolean {
  return ['pending', 'assigned'].includes(snapshot.status) && snapshot.stock_out !== true &&
    !snapshot.van_confirmed_by && !snapshot.rescheduled_to && !snapshot.reschedule_requested_to
}

export function validateDeliveryEditPatch(value: unknown, snapshot: DeliveryEditSnapshot): DeliveryEditPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid delivery changes.')
  const input = value as Record<string, unknown>
  const patch: DeliveryEditPatch = {}
  for (const key of Object.keys(input)) {
    if (!deliveryEditFields.includes(key as DeliveryEditField)) throw new Error('Unsupported delivery field.')
    const val = input[key]
    if (key === 'qty') {
      if (!Number.isSafeInteger(val) || Number(val) < 1) throw new Error('Quantity must be a positive whole number.')
      if (val !== snapshot.qty) patch.qty = Number(val)
      continue
    }
    if (!(val === null || typeof val === 'string')) throw new Error('Invalid delivery field value.')
    const normalized = typeof val === 'string' ? val.trim() || null : null
    if (normalized === snapshot[key as Exclude<DeliveryEditField, 'qty'>]) continue
    if (key === 'delivery_date') {
      if (!isDateOnly(normalized)) throw new Error('Choose a valid delivery date.')
      if (!canCorrectDeliveryDate(snapshot)) throw new Error('This order has dispatch or reschedule activity. Use the existing reschedule workflow.')
    }
    if (key === 'contact_1' && !normalized) throw new Error('Primary contact cannot be cleared here.')
    patch[key as Exclude<DeliveryEditField, 'qty'>] = normalized
  }
  return patch
}

export function sameDeliveryEditSnapshot(left: DeliveryEditSnapshot, right: DeliveryEditSnapshot): boolean {
  return left.id === right.id && deliveryEditGuardFields.every(key => left[key] === right[key])
}
