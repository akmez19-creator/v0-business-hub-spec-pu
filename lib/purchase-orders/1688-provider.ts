import 'server-only'

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import type { SupabaseClient } from '@supabase/supabase-js'
import { TMAPI_BASE, isAlibabaHosted } from '@/lib/product-master/tmapi'
import { normalizeUnit, publishedOrderMultiple, publishedPackSize } from './1688-comparison'
import type { Listing1688, PriceTier1688, SearchHit1688, Shop1688, Sku1688 } from './1688-types'

type Raw = Record<string, unknown>
const object = (value: unknown): Raw => value && typeof value === 'object' && !Array.isArray(value) ? value as Raw : {}
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const text = (value: unknown): string | null => (typeof value === 'string' || typeof value === 'number') && String(value).trim() ? String(value).trim() : null
export const publishedNumber = (value: unknown): number | null => {
  if (value == null || value === '' || typeof value === 'boolean') return null
  const source = String(value).trim().replace(/^[¥￥]\s*/, '')
  if (!/^-?\d+(?:\.\d+)?$/.test(source)) return null
  const number = Number(source)
  return Number.isFinite(number) && number >= 0 ? number : null
}
const flag = (value: unknown) => value === true || value === 1 || value === '1' || value === 'true'
const imageUrl = (value: unknown): string | null => {
  const source = text(value)
  if (!source) return null
  try {
    const url = new URL(source.startsWith('//') ? `https:${source}` : source)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch { return null }
}

function properties(value: unknown): { name: string; value: string }[] {
  return array(value).flatMap(entry => {
    const data = object(entry)
    if (text(data.name) && text(data.value)) return [{ name: text(data.name)!, value: text(data.value)! }]
    return Object.entries(data).flatMap(([name, raw]) => text(raw) ? [{ name, value: text(raw)! }] : [])
  })
}
function tiers(value: unknown, skuId: string | null, source: string): PriceTier1688[] {
  return array(value).flatMap(entry => {
    const raw = object(entry)
    const minQty = publishedNumber(raw.beginAmount ?? raw.begin_num)
    const price = publishedNumber(raw.price)
    const maxQty = publishedNumber(raw.endAmount ?? raw.end_num)
    return minQty != null && minQty >= 1 && Number.isInteger(minQty) && price != null && price > 0 && (maxQty == null || Number.isInteger(maxQty) && maxQty >= minQty) ? [{ minQty, maxQty, price, skuId, source }] : []
  }).sort((a, b) => a.minQty - b.minQty)
}

export function normalizeListing(data: Raw, offerId: string, observedAt = new Date().toISOString()): Listing1688 {
  if (text(data.item_id) && text(data.item_id) !== offerId) throw new Provider1688Error('Provider returned another offer. No comparison was accepted.', 'identity', true)
  const rawSkus = array(data.skus)
  const unit = normalizeUnit(text(data.offer_unit))
  const productProps = properties(data.product_props)
  const quantityMultiple = publishedOrderMultiple(productProps.map(prop => `${prop.name}: ${prop.value}`).join('\n'))
  const globalTiers = tiers(object(data.tiered_price_info).prices, null, 'Listing quantity ladder; SKU applicability not established')
  const propValues = new Map<string, { name: string; value: string; image: string | null }>()
  for (const rawProp of array(data.sku_props)) {
    const prop = object(rawProp)
    for (const rawValue of array(prop.values)) {
      const value = object(rawValue)
      propValues.set(`${text(prop.pid)}:${text(value.vid)}`, { name: text(prop.prop_name) ?? '', value: text(value.name) ?? '', image: imageUrl(value.imageUrl) })
    }
  }
  const seen = new Set<string>()
  const skus: Sku1688[] = rawSkus.map((entry, index) => {
    const raw = object(entry)
    const providerId = text(raw.skuid)
    const specId = text(raw.specid)
    const propsIds = text(raw.props_ids)
    const id = providerId ?? specId ?? propsIds ?? `unidentified:${index}`
    if (seen.has(id)) throw new Error('Provider returned duplicate SKU identities; listing was not safely normalized')
    seen.add(id)
    const attrs = (propsIds ?? '').split(';').map(key => propValues.get(key)).filter(value => value != null)
    const price = publishedNumber(raw.sale_price)
    const skuUnit = normalizeUnit(text(raw.offer_unit)) ?? unit
    return {
      id, providerId, specId, propsIds, name: text(raw.props_names) ?? '',
      attributes: attrs.length ? attrs.map(({ name, value }) => ({ name, value })) : (text(raw.props_names) ?? '').split(';').flatMap(prop => {
        const split = prop.indexOf(':')
        return split >= 0 ? [{ name: prop.slice(0, split), value: prop.slice(split + 1) }] : []
      }),
      imageUrl: attrs.find(value => value.image)?.image ?? null,
      price, regularPrice: publishedNumber(raw.origin_price), priceSource: price == null ? null : 'SKU sale_price',
      stock: publishedNumber(raw.stock), unit: skuUnit, packSize: publishedPackSize(text(raw.props_names) ?? '') ?? (skuUnit === 'piece' ? 1 : skuUnit === 'pair' ? 2 : null),
      quantityMultiple: publishedOrderMultiple(text(raw.props_names) ?? '') ?? quantityMultiple,
      tiers: tiers(object(raw.tiered_price_info).prices, id, 'SKU-specific quantity ladder').concat(rawSkus.length === 1 ? globalTiers.map(tier => ({ ...tier, skuId: id, source: 'Quantity ladder on a single-SKU listing' })) : []),
    }
  })
  const images = array(data.main_imgs).map(imageUrl).filter((url): url is string => Boolean(url))
  const pricing = object(data.price_info)
  const shipping = object(data.delivery_info)
  const supplier = object(data.shop_info)
  return {
    offerId, title: text(data.title) ?? '', pageUrl: `https://detail.1688.com/offer/${offerId}.html`,
    imageUrl: images[0] ?? null, images, observedAt, soldOut: flag(data.is_sold_out),
    moq: publishedNumber(data.moq) ?? publishedNumber(object(data.tiered_price_info).begin_num), unit,
    quantityMultiple, productProps, skus,
    supplier: { name: text(supplier.shop_name) ?? text(supplier.seller_login_id), memberId: text(supplier.seller_member_id) },
    price: { min: publishedNumber(pricing.price_min) ?? publishedNumber(pricing.price), max: publishedNumber(pricing.price_max), promotion: publishedNumber(pricing.discount_price), tiers: globalTiers },
    freight: { fee: publishedNumber(shipping.delivery_fee), shipsFrom: text(shipping.location) },
  }
}

export function normalizeShop(data: Raw, memberId: string, observedAt = new Date().toISOString()): Shop1688 {
  if (text(data.member_id) && text(data.member_id) !== memberId) throw new Provider1688Error('Provider returned a different shop. Ratings were not linked.', 'identity', true)
  const ratings = array(data.shop_ratings).flatMap(value => {
    const raw = object(value)
    const score = publishedNumber(raw.score)
    return score != null && score <= 5 ? [{ type: text(raw.type) ?? '', title: text(raw.title) ?? '', score }] : []
  })
  return { memberId, names: [...new Set(['company_name', 'shop_name', 'seller_login_id', 'login_id'].map(key => text(data[key])).filter((value): value is string => !!value))], rating: ratings.find(rating => rating.type === 'comprehensive')?.score ?? null, ratings, observedAt, error: null, years: publishedNumber(data.tp_year), isFactory: flag(data.is_factory) || flag(data.is_super_factory), location: text(data.location_str) }
}

export class Provider1688Error extends Error {
  constructor(message: string, public reason: string, public terminal: boolean, public httpStatus = 502) { super(message) }
}
export async function boundedBytes(response: Response, max: number): Promise<Buffer> {
  if (Number(response.headers.get('content-length')) > max) throw new Error('Response exceeds the safe size limit')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Empty response')
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > max) throw new Error('Response exceeds the safe size limit; no variants were silently discarded')
      chunks.push(chunk.value)
    }
  } catch (cause) { await reader.cancel(); throw cause }
  return Buffer.concat(chunks)
}

export function trustedImage(value: string): URL {
  const url = new URL(value.startsWith('//') ? `https:${value}` : value)
  const hosts = [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_DB_SUPABASE_URL].flatMap(value => { try { return value ? [new URL(value).hostname] : [] } catch { return [] } })
  const accepted = /(^|\.)(alicdn\.com|alibaba\.com|1688\.com|public\.blob\.vercel-storage\.com)$/i.test(url.hostname) || (hosts.includes(url.hostname) && url.pathname.startsWith('/storage/v1/object/public/'))
  if (!accepted || !['http:', 'https:'].includes(url.protocol) || url.port || url.username || url.password || isIP(url.hostname)) throw new Error('Photo host is not permitted for supplier research')
  url.protocol = 'https:'
  return url
}
function privateAddress(address: string) {
  if (address.includes(':')) return /^(::|fc|fd|fe80|ff)/i.test(address) || address.includes('::ffff:')
  const [a, b] = address.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127)
}
export async function safeImageBytes(value: string): Promise<Buffer> {
  let url = trustedImage(value)
  const signal = AbortSignal.timeout(6_000)
  for (let redirects = 0; redirects <= 2; redirects++) {
    const addresses = await lookup(url.hostname, { all: true })
    if (!addresses.length || addresses.some(result => privateAddress(result.address))) throw new Error('Photo resolved to a private address')
    const response = await fetch(url, { redirect: 'manual', signal, cache: 'no-store' })
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); url = trustedImage(new URL(response.headers.get('location') ?? '', url).href); continue }
    if (!response.ok || !/^image\/(jpeg|png|webp|avif)/i.test(response.headers.get('content-type') ?? '')) { await response.body?.cancel(); throw new Error('Photo could not be safely decoded') }
    const bytes = await boundedBytes(response, 5_000_000)
    return sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 72 }).toBuffer()
  }
  throw new Error('Too many image redirects')
}

async function request1688(path: string, params: Record<string, string>, body?: unknown) {
  const token = process.env.TMAPI_TOKEN
  if (!token) throw new Provider1688Error('The 1688 provider connection is not configured', 'provider-auth', true)
  const url = `${TMAPI_BASE}${path}?${new URLSearchParams({ ...params, apiToken: token })}`
  let response: Response
  try {
    response = await fetch(url, { method: body ? 'POST' : 'GET', headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(25_000) })
  } catch { throw new Provider1688Error('Provider request timed out or was interrupted; retry explicitly', 'network', false) }
  let json: Raw
  try { json = object(JSON.parse((await boundedBytes(response, 6_000_000)).toString('utf8'))) } catch { throw new Provider1688Error('Provider response was unreadable or too large to verify completely', 'provider', true) }
  const code = String(json.code ?? response.status)
  const message = text(json.msg ?? json.message) ?? ''
  if ([402, 439].includes(response.status) || ['402', '439'].includes(code) || /insufficient.*(?:balance|credit)|no.*credit|余额不足/i.test(message)) throw new Provider1688Error('TMAPI credit is exhausted. Remaining paid work was not started.', 'credit', true, 402)
  if ([401, 403].includes(response.status) || /invalid.*(?:token|key)|unauthori[sz]ed|token.*expired/i.test(message)) throw new Provider1688Error('The provider rejected the connection. Remaining paid work was not started.', 'provider-auth', true)
  if ((response.status === 404 || code === '404' || /item not found|item deleted|listing removed/i.test(message)) && path === '/1688/item_detail') throw new Provider1688Error('This listing is unavailable on 1688', 'gone', false, 404)
  if (!response.ok || !['200', '0'].includes(code)) throw new Provider1688Error(`The provider could not complete this lookup (HTTP ${response.status}, code ${code}).`, 'provider', true)
  if (!json.data || typeof json.data !== 'object') throw new Provider1688Error('Provider returned no usable evidence', 'provider', true)
  return json.data
}

export type ResearchProvider1688 = {
  listing: (id: string) => Promise<Listing1688>
  shop: (memberId: string) => Promise<Shop1688>
  prepareImage: (image: string) => Promise<{ ref: string; paid: boolean }>
  search: (mode: 'image' | 'keyword', value: string) => Promise<SearchHit1688[]>
}
export function researchProvider(db: SupabaseClient): ResearchProvider1688 {
  return {
    listing: async id => normalizeListing(object(await request1688('/1688/item_detail', { item_id: id })), id),
    shop: async member => normalizeShop(object(await request1688('/1688/shop/shop_info', { member_id: member })), member),
    prepareImage: async image => {
      const allowed = trustedImage(image)
      if (isAlibabaHosted(allowed.href)) return { ref: allowed.href, paid: false }
      let bytes = await safeImageBytes(allowed.href)
      if (bytes.length > 280_000) bytes = await sharp(bytes).resize({ width: 600, height: 600, fit: 'inside' }).jpeg({ quality: 60 }).toBuffer()
      if (bytes.length > 300_000) throw new Error('Photo is still too large for the 1688 converter')
      const path = `search-tmp/reorder-${randomUUID()}.jpg`
      const { error } = await db.storage.from('product-images').upload(path, bytes, { contentType: 'image/jpeg', upsert: false })
      if (error) throw new Error('Could not prepare the product photo; no image-conversion lookup was started')
      try {
        const url = db.storage.from('product-images').getPublicUrl(path).data.publicUrl
        const data = object(await request1688('/1688/tools/image/convert_url', {}, { url, search_api_endpoint: '/search/image' }))
        const ref = text(data.image_url ?? data.url ?? data.img_url)
        if (!ref || (!ref.startsWith('/search/') && !isAlibabaHosted(ref))) throw new Error('1688 did not return a valid image-search reference')
        return { ref, paid: true }
      } finally { await db.storage.from('product-images').remove([path]) }
    },
    search: async (mode, value) => {
      const data = await request1688(mode === 'image' ? '/1688/search/image' : '/1688/search/items', { page: '1', page_size: '20', ...(mode === 'image' ? { img_url: value } : { keyword: value }) })
      const source = object(data)
      const raw = Array.isArray(data) ? data : array(source.items ?? source.result ?? source.list)
      return raw.slice(0, 20).flatMap((entry, position) => {
        const item = object(entry)
        const id = text(item.item_id ?? item.offer_id ?? item.id)
        if (!id || !/^\d{6,}$/.test(id)) return []
        const shop = object(item.shop_info)
        return [{ offerId: id, title: text(item.title) ?? '', imageUrl: imageUrl(item.img ?? item.pic_url ?? item.image_url ?? array(item.main_imgs)[0]), supplierName: text(shop.company_name ?? shop.shop_name ?? shop.login_id ?? item.shop_name), memberId: text(shop.member_id ?? shop.seller_member_id ?? item.seller_member_id), source: mode, position }]
      })
    },
  }
}
