import { readFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ImportReference, SavedReorderItem } from '../lib/purchase-orders/workflow.ts'
import type { ReorderCatalogue } from '../lib/purchase-orders/reorder-service.ts'
import type { CheckCommand1688, Listing1688, OfferInterpretation, SavedCheck1688, Target1688 } from '../lib/purchase-orders/1688-types.ts'
import * as workflowModule from '../lib/purchase-orders/workflow.ts'
import * as providerModule from '../lib/purchase-orders/1688-provider.ts'
import * as serviceModule from '../lib/purchase-orders/1688-check-service.ts'
import * as qualityModule from '../lib/purchase-orders/supplier-quality.ts'
import * as referenceModule from '../lib/purchase-orders/reorder-reference.ts'

// Node 24 exposes this CommonJS Next.js project through the ESM default namespace.
export const interop = <T>(module: T): T => (module as { default?: T }).default ?? module
const { newReorderLine, IMPORT_REFERENCE_COLUMNS } = interop(workflowModule)
const { reviewImportReferences } = interop(referenceModule)
const { normalizeListing, normalizeShop, Provider1688Error } = interop(providerModule)
const { loadResearchContexts, loadSavedResearch, processResearchCommand } = interop(serviceModule)
const { loadSupplierQuality, observeSupplier } = interop(qualityModule)

export const ACTOR = '10000000-0000-4000-8000-000000000001'
export const OTHER_BUYER = '10000000-0000-4000-8000-000000000002'
export const WRONG_ROLE = '10000000-0000-4000-8000-000000000003'
export const stamp = '2026-09-01T10:00:00.000Z'
export const testId = (kind: number, index = 0) => `${String(kind).padStart(8, '0')}-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
export const clone = <T>(value: T): T => structuredClone(value)
const tableNames = new Set(['profiles', 'products', 'product_variants', 'product_links', 'purchase_orders', 'import_reorder_items', 'import_reorder_lines', 'import_reorders', 'import_reorder_settings', 'import_purchase_events', 'foreign_supplier_profiles', 'foreign_supplier_aliases', 'foreign_supplier_quality_notes', 'import_reorder_1688_checks', 'import_reorder_1688_runs', 'import_reorder_1688_jobs', 'product_1688_preferences', 'product_1688_sku_links', 'import_reorder_1688_selections'])
const identifier = (value: string) => { if (!/^[a-z_][a-z_0-9]*$/i.test(value)) throw new Error(`Unsafe test SQL identifier: ${value}`); return `"${value}"` }
const json = (value: unknown): any => JSON.parse(JSON.stringify(value))

export function targetFixture(): Target1688 {
  return { status: 'established', summary: 'Black 60cm storage rack', facts: [{ field: 'product', value: 'storage rack', quote: 'storage rack' }, { field: 'size', value: '60cm', quote: '60cm' }, { field: 'color', value: 'black', quote: 'black' }, { field: 'contents', value: 'complete rack', quote: 'complete rack' }], requiredFields: ['product', 'size', 'color', 'contents'], sourceSku: null, unit: 'piece', packSize: 1, specification: '', confirmedBy: ACTOR, confirmedAt: stamp, reason: 'Isolated, buyer-confirmed comparison fixture' }
}

export function rawListing(offerId = '888888000001', price = '9.50', count = 1) {
  return { item_id: offerId, title: 'storage rack', offer_unit: '件', moq: 10, is_sold_out: false, product_props: [{ name: '订购倍数', value: '1' }], main_imgs: [], price_info: { price_min: '1', price_max: '12', discount_price: '8' }, tiered_price_info: { begin_num: 10, prices: [] }, delivery_info: { delivery_fee: '4.50', location: 'Guangdong' }, shop_info: { shop_name: offerId === '888888000000' ? 'QA Original Supplier' : 'QA Alternative Supplier', seller_member_id: offerId === '888888000000' ? 'qa-original-member' : 'qa-alternative-member' }, sku_props: [], skus: Array.from({ length: count }, (_, index) => ({ skuid: `sku-${index}`, specid: `spec-${index}`, props_ids: `0:${index}`, props_names: `color: black; size: ${index === count - 1 ? '60cm' : '30cm'}; contents: complete rack`, sale_price: price, origin_price: '12', stock: 1000 })) }
}

export function listingFixture(offerId = '888888000001', price = '9.50', count = 1) { return normalizeListing(rawListing(offerId, price, count), offerId, stamp) }
export function interpretationFixture(offer: Listing1688): OfferInterpretation {
  return { offerId: offer.offerId, observedAt: stamp, error: null, variants: offer.skus.map(sku => ({ skuId: sku.id, kind: 'full_product', kindQuote: 'complete rack', facts: [{ field: 'product', value: 'storage rack', quote: 'storage rack' }, { field: 'size', value: sku.name.includes('30cm') ? '30cm' : '60cm', quote: sku.name.includes('30cm') ? '30cm' : '60cm' }, { field: 'color', value: 'black', quote: 'black' }, { field: 'contents', value: 'complete rack', quote: 'complete rack' }], unit: 'piece', packSize: 1, unitQuote: 'piece', reason: 'Interpreted only from controlled fixture specifications' })) }
}

class Query {
  columns = ''; conditions: string[] = []; params: unknown[] = []; orders: string[] = []; offset = 0; count = 1000; singular = false; required = false
  constructor(private fixture: ResearchFixture, private table: string) { if (!tableNames.has(table)) throw new Error(`Forbidden research access: ${table}`) }
  select(columns: string) { this.columns = columns.split(',').map(value => identifier(value.trim())).join(','); return this }
  parameter(value: unknown) { this.params.push(value); return `$${this.params.length}` }
  eq(column: string, value: unknown) { this.conditions.push(`${identifier(column)} = ${this.parameter(value)}`); return this }
  in(column: string, values: unknown[]) { this.conditions.push(`${identifier(column)} = any(${this.parameter(values)})`); return this }
  not(column: string, operator: string, value: unknown) { if (operator !== 'is' || value !== null) throw new Error('Unsupported test filter'); this.conditions.push(`${identifier(column)} is not null`); return this }
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) { this.orders.push(`${identifier(column)} ${options?.ascending === false ? 'desc' : 'asc'} nulls ${options?.nullsFirst ? 'first' : 'last'}`); return this }
  range(from: number, to: number) { this.offset = from; this.count = to - from + 1; return this }
  limit(count: number) { this.count = count; return this }
  maybeSingle() { this.singular = true; return this }
  single() { this.singular = true; this.required = true; return this }
  or(filter: string) {
    const match = filter.match(/^created_at\.lt\.(.+),and\(created_at\.eq\.(.+),id\.lt\.([\w-]+)\)$/)
    if (!match || match[1] !== match[2]) throw new Error('Unexpected pagination predicate')
    this.conditions.push(`(created_at < ${this.parameter(match[1])}::timestamptz or (created_at = ${this.parameter(match[2])}::timestamptz and id < ${this.parameter(match[3])}::uuid))`)
    return this
  }
  async run() {
    this.fixture.reads.push(this.table)
    if (this.fixture.failRead === this.table) { this.fixture.failRead = null; return { data: null, error: { code: '08006', message: 'Isolated read failure' } } }
    try {
      const result = await this.fixture.sql.query(`select ${this.columns} from public.${identifier(this.table)}${this.conditions.length ? ` where ${this.conditions.join(' and ')}` : ''}${this.orders.length ? ` order by ${this.orders.join(', ')}` : ''} limit ${this.count} offset ${this.offset}`, this.params)
      const rows = json(result.rows).map((row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([key, value]) => {
        const type = result.fields.find(field => field.name === key)?.dataTypeID
        return [key, value == null ? value : type === 1700 ? Number(value) : type === 1082 ? String(value).slice(0, 10) : value]
      })))
      if (this.singular && (rows.length > 1 || this.required && rows.length !== 1)) throw new Error('Single-row result mismatch')
      return { data: this.singular ? rows[0] ?? null : rows, error: null }
    } catch (cause) { return { data: null, error: { code: (cause as any).code ?? 'TEST', message: (cause as Error).message } } }
  }
  then(resolve: any, reject: any) { return this.run().then(resolve, reject) }
}

export class ResearchFixture {
  sql = new PGlite()
  reads: string[] = []
  writes: string[] = []
  providerCalls: string[] = []
  failRead: string | null = null
  failRpc: string | null = null
  failStage: string | null = null
  terminal = false
  delay = 0
  providerActive = 0
  maxProviderActive = 0
  afterProvider: (() => Promise<void>) | null = null
  catalogue: ReorderCatalogue = { products: [], references: [], stocks: [], suppliers: ['QA Original Supplier', 'QA Alternative Supplier', 'QA Similar Supplier', 'QA Similar Supplier Ltd'] }
  imageFiles = new Map<string, Buffer>()
  imageUploadError: string | null = null
  imagePublicBase = 'https://isolated.supabase.co/storage/v1/object/public/product-images/'
  db = {
    storage: { from: (bucket: string) => {
      if (bucket !== 'product-images') throw new Error('Unexpected image bucket in isolated verification')
      return {
        upload: async (path: string, bytes: Buffer, options: { upsert: boolean }) => {
          if (options.upsert) throw new Error('Immutable sourcing images must never overwrite files')
          if (this.imageUploadError) return { error: { message: this.imageUploadError, statusCode: '503' } }
          if (this.imageFiles.has(path)) return { error: { message: 'Already exists', statusCode: '409' } }
          this.imageFiles.set(path, Buffer.from(bytes)); return { error: null }
        },
        download: async (path: string) => ({ data: this.imageFiles.has(path) ? new Blob([new Uint8Array(this.imageFiles.get(path)!)]) : null, error: this.imageFiles.has(path) ? null : { message: 'Missing image fixture' } }),
        getPublicUrl: (path: string) => ({ data: { publicUrl: `${this.imagePublicBase}${path}` } }),
      }
    } },
    from: (table: string) => new Query(this, table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (!['foreign_supplier_identity', 'foreign_supplier_save_note', 'foreign_supplier_observe', 'import_reorder_1688_transition', 'import_1688_guard', 'import_1688_queue', 'import_1688_selection', 'import_reorder_mutate', 'import_record_ordered_lines', 'import_reorder_support'].includes(name)) throw new Error(`Forbidden research mutation: ${name}`)
      const operation = String(args.p_operation ?? name)
      this.writes.push(operation)
      if (this.failRpc === operation) { this.failRpc = null; return { data: null, error: { code: '08006', message: 'Isolated storage interruption' } } }
      try {
        const keys = Object.keys(args)
        const { rows } = await this.sql.query(`select public.${identifier(name)}(${keys.map((key, index) => `${identifier(key)} => $${index + 1}`).join(',')}) as value`, keys.map(key => typeof args[key] === 'object' && args[key] !== null ? JSON.stringify(args[key]) : args[key]))
        return { data: json(rows[0].value), error: null }
      } catch (cause) { return { data: null, error: { code: (cause as any).code ?? 'TEST', message: (cause as Error).message } } }
    },
  } as unknown as SupabaseClient

  async init() {
    await this.sql.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; grant usage on schema auth,public to anon,authenticated,service_role;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
      create table public.profiles(id uuid primary key, email text not null, name text, role text not null);
      create table public.products(id uuid primary key default gen_random_uuid(), name text not null, image_url text, description text, sku text, updated_at timestamptz, is_active boolean, quantity integer default 100, price numeric default 25, cost_price numeric default 7, has_variants boolean default false, category text, bundle_prices jsonb, is_b1g1 boolean default false, price_spx2 numeric, price_spx3 numeric, price_b1g1 numeric, promo_price numeric, sold_out boolean default false, last_counted_at timestamptz, zone text);
      create table public.product_variants(id uuid primary key default gen_random_uuid(),product_id uuid not null references public.products(id),attribute_name text not null,attribute_value text not null,image_url text,updated_at timestamptz default now(),is_active boolean default true,quantity integer default 0,price_override numeric,sku text,created_at timestamptz default now(),unique(product_id,attribute_name,attribute_value));
      create table public.product_links(id uuid primary key default gen_random_uuid(),product_id uuid references public.products(id),product_name text not null default '',url text not null,offer_id text,label text,is_active boolean not null default false,status text not null default 'unknown',last_checked_at timestamptz,position integer not null default 0,created_by uuid,created_at timestamptz not null default now());
      create table public.purchase_orders(id uuid primary key default gen_random_uuid(),product_id uuid references public.products(id),product_name text,supplier_name text,index_no text,link text,image_url text,status text,qty integer,unit_price numeric,discounted_unit_price numeric,shipment_to_warehouse numeric,discounted_shipment_to_warehouse numeric,discounted_percentage numeric,total_payment_supplier_yuan numeric,total_payment_supplier numeric,weight_kg numeric,cbm numeric,boxes integer,import_cp numeric,order_date date,created_at timestamptz default now(),updated_at timestamptz default now(),reorder text,carton text,payment_link text,cbm_cost numeric,total_cp_import numeric,tracking_number text);
      grant select on public.profiles to authenticated; grant select,insert,update on public.profiles,public.products,public.product_variants,public.product_links,public.purchase_orders to service_role;
    `)
    for (const file of ['create-import-reorder-storage.sql', 'create-import-reorder-workflow.sql', 'create-import-reorder-support.sql', 'create-supplier-quality-and-1688-checks.sql', 'create-1688-sourcing-storage.sql', 'create-1688-durable-queue.sql', 'create-1688-shared-import.sql', 'create-1688-sourcing-selection.sql']) {
      await this.sql.exec(await readFile(new URL(`./${file}`, import.meta.url), 'utf8'))
    }
    for (const [id, role, name] of [[ACTOR, 'admin', 'QA Buyer'], [OTHER_BUYER, 'manager', 'QA Second Buyer'], [WRONG_ROLE, 'marketing_agent', 'QA Non-buyer']]) await this.sql.query('insert into public.profiles(id,email,name,role) values($1,$2,$3,$4)', [id, `${id}@isolated.invalid`, name, role])
    for (let index = 0; index < 6; index++) {
      const productId = testId(2, index)
      const name = ['Black Storage Rack', 'Kitchen Storage Rack', 'Tall Storage Rack', 'Compact Storage Rack', 'Shelf Storage Rack', 'Missing Link Rack'][index]
      await this.sql.query('insert into public.products(id,name,image_url,description,sku,updated_at,is_active) values($1,$2,null,$3,null,$4,true)', [productId, name, 'storage rack; size: 60cm; color: black; contents: complete rack', stamp])
      const product = { id: productId, name, imageUrl: null, category: 'Home', stockOnHand: 100, pricing: { price: 25, bundle_prices: null, is_b1g1: false, price_spx2: null, price_spx3: null, price_b1g1: null, promo_price: null, has_variants: false, hasVariantPrice: false, updated_at: stamp }, variants: [] }
      this.catalogue.products.push(product)
      const reference: ImportReference = { id: testId(3, index), product_id: productId, product_name: name, supplier_name: this.catalogue.suppliers[index % 4], index_no: `QA-${index + 1}`, link: index === 5 ? null : 'https://detail.1688.com/offer/888888000000.html', image_url: null, status: 'Received', qty: 300, unit_price: 11.5, discounted_unit_price: 10.5, shipment_to_warehouse: 50, discounted_shipment_to_warehouse: 45, discounted_percentage: -0.08695652, total_payment_supplier_yuan: 3195, total_payment_supplier: 26838, weight_kg: 30, cbm: 1, boxes: 10, import_cp: 89.46, order_date: '2026-09-01', created_at: stamp, variant_id: null, variant_snapshot: null }
      const keys = Object.keys(reference)
      await this.sql.query(`insert into public.purchase_orders(${keys.map(identifier).join(',')}) values(${keys.map((_, i) => `$${i + 1}`).join(',')})`, keys.map(key => (reference as any)[key]))
      this.catalogue.references.push(reference)
      const line = { ...newReorderLine(product), id: testId(5, index), qty: 300, priceCny: 10.5, chinaFreight: 45, sourceImportId: reference.id, sourceSnapshot: reference, listingUrl: reference.link ?? '' }
      await this.sql.query('insert into public.import_reorder_items(id,product_id,source_import_id,supplier_name,item,updated_at) values($1,$2,$3,$4,$5,$6)', [testId(4, index), productId, reference.id, reference.supplier_name, JSON.stringify(line), stamp])
    }
    return this
  }
  async items(): Promise<SavedReorderItem[]> {
    const { rows } = await this.sql.query('select id,item,supplier_name,status,priority,review_date,revision,updated_at from public.import_reorder_items order by id')
    return json(rows).map((row: any) => ({ id: row.id, item: row.item, supplierName: row.supplier_name, status: row.status, priority: row.priority, reviewDate: row.review_date, revision: row.revision, updatedAt: row.updated_at }))
  }
  async props() {
    const items = await this.items()
    const { data: references, error } = await this.db.from('purchase_orders').select(IMPORT_REFERENCE_COLUMNS).order('id')
    if (error) throw error
    this.catalogue.references = reviewImportReferences(references as ImportReference[])
    const contexts = await loadResearchContexts(this.db, items, this.catalogue.references)
    const initialChecks = await loadSavedResearch(this.db, contexts)
    const initialQuality = await loadSupplierQuality(this.db)
    return { catalogue: this.catalogue, items, contexts, initialChecks, initialQuality }
  }
  async check(index = 0): Promise<SavedCheck1688 | null> { const { data, error } = await this.db.from('import_reorder_1688_checks').select('item_id,item_revision,generation,version,context_hash,context,run_key,actor_id,status,cursor,evidence,previous_success,started_at,updated_at,finished_at,lease_key,lease_until,stop_requested,last_control_key,last_control_hash,last_stage_key').eq('item_id', testId(4, index)).maybeSingle(); if (error) throw error; return data }
  async call<T>(name: string, run: () => T): Promise<T> {
    this.providerCalls.push(name); this.providerActive++; this.maxProviderActive = Math.max(this.maxProviderActive, this.providerActive)
    try {
      if (this.delay) await new Promise(resolve => setTimeout(resolve, this.delay))
      if (this.failStage === name) { this.failStage = null; throw new Provider1688Error(`Isolated ${name} failure`, this.terminal ? 'credit' : 'network', this.terminal) }
      if (this.afterProvider) { const action = this.afterProvider; this.afterProvider = null; await action() }
      return run()
    } finally { this.providerActive-- }
  }
  ports = {
    provider: {
      listing: (id: string) => this.call(`listing:${id}`, () => listingFixture(id, id.endsWith('000000') ? '11.50' : '9.50', id.endsWith('000001') ? 51 : 1)),
      shop: (member: string) => this.call(`shop:${member}`, () => normalizeShop({ member_id: member, company_name: member === 'qa-original-member' ? 'QA Original Supplier' : 'QA Alternative Supplier', shop_ratings: [{ type: 'comprehensive', title: 'Overall', score: '4.6' }] }, member)),
      prepareImage: async () => this.call('image-prepare', () => ({ ref: 'https://cbu01.alicdn.com/fixture.jpg', paid: false })),
      search: (mode: 'image' | 'keyword') => this.call(`search:${mode}`, () => Array.from({ length: 6 }, (_, index) => ({ offerId: `88888800000${index}`, title: 'storage rack', imageUrl: null, memberId: index === 0 ? 'qa-original-member' : 'qa-alternative-member', supplierName: index === 0 ? 'QA Original Supplier' : 'QA Alternative Supplier', source: mode, position: index }))),
    },
    target: async () => this.call('ai:target', () => ({ target: { ...targetFixture(), status: 'needs_confirmation' as const, confirmedBy: null, confirmedAt: null }, query: 'storage rack' })),
    interpret: (offer: Listing1688) => this.call(`ai:${offer.offerId}`, () => interpretationFixture(offer)),
    observe: (shop: Parameters<typeof observeSupplier>[2]) => observeSupplier(this.db, ACTOR, shop, this.catalogue.suppliers),
  }
  async command(index = 0, operation: CheckCommand1688['operation'] = 'start', patch: Partial<CheckCommand1688> = {}): Promise<CheckCommand1688> {
    const check = await this.check(index)
    const item = (await this.items())[index]
    return { operation, itemId: item.id, revision: item.revision, generation: check?.generation ?? 0, version: check?.version ?? 0, requestKey: randomUUID(), runKey: operation === 'start' ? randomUUID() : check?.run_key ?? randomUUID(), ...(operation === 'start' ? { mode: 'fresh' as const } : {}), ...patch }
  }
  async process(command: CheckCommand1688, actor = ACTOR) { return processResearchCommand(this.db, actor, command, this.ports) }
  async run(index = 0, mode: 'fresh' | 'resume' = 'fresh') {
    let response = await this.process(await this.command(index, 'start', { mode }))
    for (let count = 0; response.check.status === 'running' && count < 60; count++) response = await this.process(await this.command(index, 'next'))
    return response.check
  }
  async businessHash() {
    const snapshots = await Promise.all(['products', 'product_variants', 'purchase_orders', 'import_reorder_items'].map(async table => { const { rows } = await this.sql.query(`select md5(string_agg(to_jsonb(t)::text, '|' order by id)) as hash from public.${identifier(table)} t`); return { table, hash: rows[0].hash } }))
    return createHash('sha256').update(JSON.stringify(snapshots)).digest('hex')
  }
  close() { return this.sql.close() }
}
