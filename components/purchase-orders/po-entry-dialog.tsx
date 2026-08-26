'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ProductThumb } from '@/components/ui/product-thumb'
import { SupplierFinder } from './po-supplier-finder'
import type { PurchaseOrder } from './po-columns'
import { emptyPurchaseOrderDraft, PO_STATUSES, type PurchaseOrderDraft } from '@/lib/purchase-orders/workflow'

type Product = { id: string; name: string; image_url: string | null; sku: string | null }

const numericFields = ['qty','unit_price','discounted_unit_price','shipment_to_warehouse','discounted_shipment_to_warehouse','discounted_percentage','total_payment_supplier_yuan','total_payment_supplier','weight_kg','cbm','boxes','cbm_cost','import_cp','total_cp_import'] as const

function fromOrder(order: PurchaseOrder): PurchaseOrderDraft {
  const draft = emptyPurchaseOrderDraft()
  return { ...draft, product_id: order.product_id || '', supplier_name: order.supplier_name || '', link: order.link || '', image_url: order.image_url || '', reorder: order.index_no || order.id, carton: order.carton || '', qty: String(order.qty || ''), unit_price: String(order.unit_price || ''), discounted_unit_price: String(order.discounted_unit_price || ''), shipment_to_warehouse: String(order.shipment_to_warehouse || ''), discounted_shipment_to_warehouse: String(order.discounted_shipment_to_warehouse || ''), discounted_percentage: String(order.discounted_percentage || ''), total_payment_supplier_yuan: String(order.total_payment_supplier_yuan || ''), total_payment_supplier: String(order.total_payment_supplier || ''), weight_kg: String(order.weight_kg || ''), cbm: String(order.cbm || ''), boxes: String(order.boxes || ''), cbm_cost: String(order.cbm_cost || ''), import_cp: String(order.import_cp || ''), total_cp_import: String(order.total_cp_import || '') }
}

export function POEntryDialog({ products, open, onOpenChange, source }: { products: Product[]; open: boolean; onOpenChange: (open: boolean) => void; source?: PurchaseOrder | null }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [draft, setDraft] = useState<PurchaseOrderDraft>(emptyPurchaseOrderDraft)
  const [query, setQuery] = useState('')
  const [finding, setFinding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setDraft(source ? fromOrder(source) : emptyPurchaseOrderDraft()); setError(''); setFinding(false); setQuery('') } }, [open, source])
  const selected = products.find(product => product.id === draft.product_id)
  const visibleProducts = useMemo(() => products.filter(p => `${p.name} ${p.sku || ''}`.toLowerCase().includes(query.toLowerCase())).slice(0, 80), [products, query])
  const set = (key: keyof PurchaseOrderDraft, value: string) => setDraft(current => ({ ...current, [key]: value }))

  async function save() {
    setError('')
    if (!draft.product_id || !draft.supplier_name.trim() || !draft.link.trim() || Number(draft.qty) <= 0) { setError('Choose a product and enter supplier, 1688 link, and a quantity greater than zero.'); return }
    setSaving(true)
    const payload: Record<string, string | number> = { ...draft }
    for (const field of numericFields) payload[field] = Number(draft[field] || 0)
    const { data, error: rpcError } = await createClient().rpc('create_manual_purchase_order', { payload })
    setSaving(false)
    if (rpcError) { setError(rpcError.message); return }
    onOpenChange(false)
    startTransition(() => router.refresh())
    window.setTimeout(() => window.alert(`Purchase order ${(data as { index_no?: string })?.index_no || ''} created.`), 50)
  }

  return <Dialog open={open} onOpenChange={saving ? undefined : onOpenChange}>
    <DialogContent className="flex max-h-[92vh] w-[94vw] max-w-[1800px] flex-col overflow-hidden sm:max-w-[1800px]">
      <DialogHeader><DialogTitle>{source ? `Reorder ${source.index_no || ''}` : 'New Purchase Order'}</DialogTitle><DialogDescription>A new three-letter index is assigned when saved. Product Master items only.</DialogDescription></DialogHeader>
      <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto pr-2 lg:grid-cols-[1.1fr_1fr_1fr]">
        <section className="flex flex-col gap-4"><h3 className="font-semibold">1. Product</h3><Label htmlFor="product-search">Search Product Master</Label><div className="relative"><Search className="absolute left-3 top-3 size-4 text-muted-foreground"/><Input id="product-search" value={query} onChange={e => setQuery(e.target.value)} className="pl-9" placeholder="Name or SKU" /></div><div className="max-h-56 overflow-y-auto rounded-md border">{visibleProducts.map(product => <button type="button" key={product.id} onClick={() => set('product_id', product.id)} className={`flex w-full items-center gap-3 border-b p-2 text-left text-sm last:border-0 ${draft.product_id === product.id ? 'bg-accent' : 'hover:bg-muted'}`}><ProductThumb src={product.image_url} className="size-10 rounded"/><span className="min-w-0"><span className="block truncate font-medium">{product.name}</span><span className="text-xs text-muted-foreground">{product.sku || 'No SKU'}</span></span></button>)}</div>{selected && <div className="flex items-center gap-3 rounded-md bg-muted p-3"><ProductThumb src={selected.image_url} className="size-14 rounded"/><div><p className="font-medium">{selected.name}</p><p className="text-xs text-muted-foreground">Selected Product Master item</p></div></div>}<Button type="button" variant="outline" disabled={!selected} onClick={() => setFinding(value => !value)}>{finding ? 'Hide supplier search' : 'Find supplier on 1688'}</Button>{finding && selected && <div className="min-h-[420px] rounded-md border p-3"><SupplierFinder productName={selected.name} currentImage={selected.image_url} autoSearchName={false} onClose={() => setFinding(false)} onPick={url => { set('link', url); setFinding(false) }} /></div>}</section>
        <section className="flex flex-col gap-4"><h3 className="font-semibold">2. Supplier & order</h3><Field label="Supplier name" value={draft.supplier_name} onChange={v => set('supplier_name', v)} required/><Field label="1688 listing URL" value={draft.link} onChange={v => set('link', v)} required/><Field label="Listing image URL" value={draft.image_url} onChange={v => set('image_url', v)}/><div><Label>Status</Label><Select value={draft.status} onValueChange={v => set('status', v)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{PO_STATUSES.map(status => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select></div><Field label="Order date" type="date" value={draft.order_date} onChange={v => set('order_date', v)} required/><div className="grid grid-cols-2 gap-3"><Field label="Quantity" type="number" value={draft.qty} onChange={v => set('qty', v)} required/><Field label="Carton" value={draft.carton} onChange={v => set('carton', v)}/></div><h3 className="pt-2 font-semibold">Pricing</h3><div className="grid grid-cols-2 gap-3">{(['unit_price','discounted_unit_price','shipment_to_warehouse','discounted_shipment_to_warehouse','discounted_percentage','total_payment_supplier_yuan','total_payment_supplier'] as const).map(key => <Field key={key} label={key.replaceAll('_',' ')} type="number" value={draft[key]} onChange={v => set(key,v)}/>)}</div></section>
        <section className="flex flex-col gap-4"><h3 className="font-semibold">3. Logistics estimates</h3><div className="grid grid-cols-2 gap-3">{(['weight_kg','cbm','boxes','cbm_cost','import_cp','total_cp_import'] as const).map(key => <Field key={key} label={key.replaceAll('_',' ')} type="number" value={draft[key]} onChange={v => set(key,v)}/>)}</div><Field label="Payment link" value={draft.payment_link} onChange={v => set('payment_link',v)}/><Field label="Tracking number" value={draft.tracking_number} onChange={v => set('tracking_number',v)}/><div className="rounded-md border bg-muted p-4 text-sm"><p className="font-medium">New index</p><p className="mt-1 font-mono text-lg">Assigned when saved</p>{source && <p className="mt-2 text-muted-foreground">Reorder source: {source.index_no || source.id}</p>}</div></section>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? <Loader2 data-icon="inline-start" className="animate-spin"/> : <Plus data-icon="inline-start"/>}{source ? 'Create reorder' : 'Create purchase order'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

function Field({ label, value, onChange, type = 'text', required }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean }) { const id = `po-${label.replaceAll(' ','-')}`; return <div className="flex flex-col gap-2"><Label htmlFor={id} className="capitalize">{label}{required ? ' *' : ''}</Label><Input id={id} type={type} value={value} onChange={e => onChange(e.target.value)} min={type === 'number' ? 0 : undefined} step={type === 'number' ? 'any' : undefined} required={required}/></div> }
