// Finds every product that could plausibly be a duplicate of ONE given product.
//
// This is deliberately the opposite of lib/products/duplicates.ts. That scan
// sweeps the whole catalogue unattended, so it is tuned to stay QUIET - it
// drops containment matches and anything under a similarity floor, because
// 109 mostly-wrong pairs is worse than none.
//
// Here a person is looking at one product and deciding. A miss is fatal: the
// duplicate they never see is the one that stays in the catalogue forever. A
// bad candidate is just a line they skip. So this is tuned for RECALL, and the
// only filtering that ever happens is ranking - nothing is removed from view.
//
// Measured against the live catalogue (862 active products): word order and
// numeral-vs-word variants rank first on trigram alone ("2 Tier Storage
// Basket" -> "Two-tier storage basket", 0.80). The blind spot is abbreviation,
// where trigram scores literally zero ("S/S Water Bottle" vs "Stainless Steel
// Water Bottle"). No amount of string tuning fixes that, which is why the
// shared-image and shared-1688-listing channels below exist: they identify the
// same product without reading the name at all.
import type { Client } from 'pg'

export type Candidate = {
  id: string
  name: string
  zone: string | null
  shelf_code: string | null
  quantity: number | null
  sku: string | null
  last_counted_at: string | null
  po_count: number
  image_count: number
  image_url: string | null
  /** Best 0-1 name similarity. 0 when only a non-name channel matched. */
  score: number
  /** Why this surfaced, in plain words, for display next to the candidate. */
  reasons: string[]
}

export type CandidateTarget = {
  id: string
  name: string
  zone: string | null
  shelf_code: string | null
  quantity: number | null
  sku: string | null
  last_counted_at: string | null
  po_count: number
  image_count: number
  image_url: string | null
}

/**
 * How many candidates to pull from the database before ranking. Wider than the
 * five that reach the screen on purpose: the AI reorders within this pool, so
 * anything cut here can never be recovered, whereas anything merely ranked 6th
 * is still one click away behind "show more".
 */
const POOL = 25

/**
 * Channels are OR-ed. Each contributes its own evidence line, and a candidate
 * found by several is ranked above one found by a single channel.
 *
 * `similarity()` needs pg_trgm (present) and levenshtein needs fuzzystrmatch,
 * which is installable here but NOT installed by default - so the query below
 * uses only pg_trgm, and the short-name weakness levenshtein would cover is
 * handled by the token channel instead.
 */
const SQL = `
with target as (
  select id, name, lower(regexp_replace(name, '[^a-z0-9 ]+', ' ', 'gi')) norm
  from products where id = $1
),
-- Words worth matching on. Anything 3 characters or shorter is dropped, and so
-- are the filler words that appear across unrelated products; without this,
-- "for"/"with"/"set" alone would join half the catalogue together.
target_tokens as (
  select distinct t.tok from target, unnest(string_to_array((select norm from target), ' ')) as t(tok)
  where length(t.tok) > 3
    and t.tok not in ('with','for','and','the','set','pcs','pack','size','type','style','color','colour','new')
),
pool as (
  select p.id
  from products p, target
  where p.id <> target.id and p.is_active is not false
    and similarity(p.name, target.name) > 0.18

  union
  -- Containment: "Shampoo" vs "Shampoo Brush". Cut from the unattended sweep
  -- for being too noisy; kept here because a reviewer can dismiss it instantly
  -- and it is exactly how a short name and its longer twin both get created.
  select p.id from products p, target
  where p.id <> target.id and p.is_active is not false
    and (lower(p.name) like '%' || target.norm || '%' or target.norm like '%' || lower(p.name) || '%')

  union
  -- Shares a distinctive word. Catches reorderings and partial rewrites that
  -- fall under the trigram floor.
  select p.id from products p, target
  where p.id <> target.id and p.is_active is not false
    and exists (
      select 1 from target_tokens tt
      where lower(regexp_replace(p.name, '[^a-z0-9 ]+', ' ', 'gi')) ~ ('(^| )' || tt.tok || '( |$)')
    )

  union
  -- Same photo file. Name-independent, so this is what survives abbreviation,
  -- translation and complete renames.
  select pi2.product_id from product_images pi1
  join product_images pi2 on pi2.image_url = pi1.image_url and pi2.product_id <> pi1.product_id
  where pi1.product_id = $1

  union
  -- Same 1688 listing. Two rows pointing at one supplier offer are ordering the
  -- identical item, whatever they are called locally.
  select pl2.product_id from product_links pl1
  join product_links pl2 on pl2.offer_id = pl1.offer_id and pl2.product_id <> pl1.product_id
  where pl1.product_id = $1 and pl1.offer_id is not null and pl1.offer_id <> ''

  union
  -- Same SKU. Currently zero duplicates in this catalogue, but it is the
  -- cheapest possible check and stays correct if that changes.
  select p.id from products p, products t
  where t.id = $1 and p.id <> t.id and p.is_active is not false
    and p.sku is not null and trim(p.sku) <> '' and lower(trim(p.sku)) = lower(trim(t.sku))
)
select * from (
select
  p.id, p.name, p.zone, p.shelf_code, p.quantity, p.sku, p.image_url,
  p.last_counted_at,
  similarity(p.name, (select name from target)) score,
  (lower(p.name) like '%' || (select norm from target) || '%'
    or (select norm from target) like '%' || lower(p.name) || '%') contained,
  (select count(*) from purchase_orders po where po.product_id = p.id) po_count,
  -- Photos live in TWO places: the gallery table and the product's own
  -- image_url. 264 of 865 products have a main photo and no gallery row, so
  -- counting only the table told the reviewer "0 photos" next to a photo they
  -- could see, and understated the evidence behind the kept-name default.
  ((select count(*) from product_images pi where pi.product_id = p.id)
    + (case when coalesce(trim(p.image_url), '') <> '' then 1 else 0 end)) image_count,
  exists (
    select 1 from product_images x join product_images y
      on y.image_url = x.image_url and y.product_id = $1
    where x.product_id = p.id
  ) shares_image,
  exists (
    select 1 from product_links x join product_links y
      on y.offer_id = x.offer_id and y.product_id = $1
    where x.product_id = p.id and x.offer_id is not null and x.offer_id <> ''
  ) shares_link,
  (p.sku is not null and trim(p.sku) <> ''
    and lower(trim(p.sku)) = lower(trim((select sku from products where id = $1)))) shares_sku,
  (select count(*) from (
     select 1 from target_tokens tt
     where lower(regexp_replace(p.name, '[^a-z0-9 ]+', ' ', 'gi')) ~ ('(^| )' || tt.tok || '( |$)')
   ) z) shared_words
from products p
where p.id in (select id from pool)
) ranked
order by
  -- Name-independent evidence outranks any spelling score: two rows sharing a
  -- photo or a supplier listing are near-certainly one product, even at 0.00
  -- similarity, and burying those under closer-spelled strangers is the exact
  -- failure this whole channel exists to prevent.
  (shares_image or shares_link or shares_sku) desc,
  score desc,
  shared_words desc
limit ${POOL}
`

export async function findCandidates(
  client: Client,
  productId: string,
): Promise<{ target: CandidateTarget; candidates: Candidate[] }> {
  const t = await client.query(
    `select p.id, p.name, p.zone, p.shelf_code, p.quantity, p.sku, p.image_url, p.last_counted_at,
            (select count(*) from purchase_orders po where po.product_id = p.id) po_count,
            -- Counts the main image_url alongside the gallery, as above.
            ((select count(*) from product_images pi where pi.product_id = p.id)
              + (case when coalesce(trim(p.image_url), '') <> '' then 1 else 0 end)) image_count
     from products p where p.id = $1`,
    [productId],
  )
  if (!t.rowCount) throw new Error('That product no longer exists.')

  const rows = (await client.query(SQL, [productId])).rows

  const candidates: Candidate[] = rows.map(r => {
    const reasons: string[] = []
    if (r.shares_image) reasons.push('Same photo')
    if (r.shares_link) reasons.push('Same 1688 listing')
    if (r.shares_sku) reasons.push('Same SKU')
    const score = Number(r.score ?? 0)
    if (score >= 0.55) reasons.push(`Name ${Math.round(score * 100)}% alike`)
    else if (score > 0) reasons.push(`Name ${Math.round(score * 100)}% alike`)
    if (r.contained) reasons.push('One name contains the other')
    if (Number(r.shared_words) > 0) {
      reasons.push(`${r.shared_words} word${Number(r.shared_words) === 1 ? '' : 's'} in common`)
    }
    return {
      id: r.id,
      name: r.name,
      zone: r.zone,
      shelf_code: r.shelf_code,
      quantity: r.quantity,
      sku: r.sku,
      last_counted_at: r.last_counted_at,
      image_url: r.image_url,
      po_count: Number(r.po_count),
      image_count: Number(r.image_count),
      score,
      reasons,
    }
  })

  const row = t.rows[0]
  return {
    target: {
      id: row.id,
      name: row.name,
      zone: row.zone,
      shelf_code: row.shelf_code,
      quantity: row.quantity,
      sku: row.sku,
      last_counted_at: row.last_counted_at,
      image_url: row.image_url,
      po_count: Number(row.po_count),
      image_count: Number(row.image_count),
    },
    candidates,
  }
}
