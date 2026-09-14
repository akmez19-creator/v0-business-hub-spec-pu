import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { ACTOR, OTHER_BUYER, WRONG_ROLE, ResearchFixture, clone, interpretationFixture, interop, listingFixture, rawListing, stamp, targetFixture, testId } from './1688-research-fixtures.mts'
import * as typesModule from '../lib/purchase-orders/1688-types.ts'
import * as comparisonModule from '../lib/purchase-orders/1688-comparison.ts'
import * as providerModule from '../lib/purchase-orders/1688-provider.ts'
import * as serviceModule from '../lib/purchase-orders/1688-check-service.ts'
import * as qualityModule from '../lib/purchase-orders/supplier-quality.ts'
import * as analysisModule from '../lib/purchase-orders/1688-analysis.ts'

const { CHECK_LIMITS } = interop(typesModule)
const { citedFacts, compareOffer, currentRangeLabel, matchingQuality, rankFindings, sameBaseContext, skuCommercialPrice } = interop(comparisonModule)
const { boundedBytes, normalizeListing, normalizeShop, Provider1688Error, publishedNumber, trustedImage } = interop(providerModule)
const { executeResearchStage, processResearchCommand, ResearchError } = interop(serviceModule)
const { appendSupplierNote, confirmSupplierIdentity, loadSupplierQuality, observeSupplier, readQualityPage } = interop(qualityModule)
const { interpretTarget, interpretOffer } = interop(analysisModule)

const googleReply = (output: unknown) => ({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(output) }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 } })
async function withGoogleReply<T>(reply: unknown, run: (calls: Record<string, any>[]) => Promise<T>, status = 200) {
  const previousFetch = globalThis.fetch
  const previousKey = process.env.GOOGLE_AI_API_KEY
  const calls: Record<string, any>[] = []
  process.env.GOOGLE_AI_API_KEY = 'isolated-google-key'
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    assert.equal(url.origin, 'https://generativelanguage.googleapis.com')
    assert.equal(url.pathname, '/v1beta/models/gemini-2.5-flash:generateContent')
    assert.equal(url.search, '')
    assert.equal(init?.method, 'POST')
    assert.equal(new Headers(init?.headers).get('x-goog-api-key'), 'isolated-google-key')
    assert.ok(init?.signal)
    const body = JSON.parse(String(init?.body))
    calls.push(body)
    assert.equal(body.generationConfig.responseMimeType, 'application/json')
    assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, 0)
    return Response.json(reply, { status })
  }
  try { return await run(calls) }
  finally {
    globalThis.fetch = previousFetch
    if (previousKey === undefined) delete process.env.GOOGLE_AI_API_KEY
    else process.env.GOOGLE_AI_API_KEY = previousKey
  }
}

const originalFetch = globalThis.fetch
globalThis.fetch = async () => { throw new Error('External network is prohibited by this isolated regression suite') }
const results: { name: string; ok: boolean; error?: string }[] = []
async function test(name: string, run: () => unknown | Promise<unknown>) {
  try { await run(); results.push({ name, ok: true }); console.log(`PASS ${name}`) }
  catch (cause) { results.push({ name, ok: false, error: (cause as Error).stack }); console.error(`FAIL ${name}: ${(cause as Error).message}`) }
}
const target = targetFixture()
const offer = listingFixture()
const interpreted = interpretationFixture(offer)
const matches = (value = offer, wanted = target, interpretation = interpretationFixture(value), qty: number | null = 300) => compareOffer(value, wanted, qty, interpretation)
const commercial = (value = offer, qty: number | null = 300) => skuCommercialPrice(value, value.skus[0], target, qty, interpretationFixture(value).variants[0])
const researchFailure = (status: number) => (cause: unknown) => cause instanceof ResearchError && cause.status === status
let fixture: ResearchFixture | undefined

try {
  await test('Normalizes every SKU including the correct one after position 40', () => { const many = listingFixture('888888000001', '9.50', 51); assert.equal(many.skus.length, 51); assert.equal(matches(many).find(value => value.status === 'matching')?.skuId, 'sku-50') })
  await test('Retains stable SKU IDs, attributes and the matching variant photo', () => { const raw = rawListing(); raw.sku_props = [{ pid: 0, prop_name: 'Color', values: [{ vid: 0, name: 'Black', imageUrl: 'https://cbu01.alicdn.com/sku-photo.jpg' }] }] as any; const sku = normalizeListing(raw, raw.item_id).skus[0]; assert.equal(sku.providerId, 'sku-0'); assert.equal(sku.specId, 'spec-0'); assert.equal(sku.attributes[0].value, 'Black'); assert.match(sku.imageUrl!, /sku-photo/) })
  await test('Pins equivalent SKU price at 9.50, not headline 1 or promotion 8', () => assert.equal(matches()[0].applicablePrice, 9.5))
  await test('A 1-yuan accessory never beats the complete product', () => { const value = clone(offer); value.skus.unshift({ ...value.skus[0], id: 'accessory', price: 1, name: 'accessory only; black; 60cm' }); const ranked = rankFindings(matches(value)); assert.equal(ranked[0].skuId, 'sku-0'); assert.equal(ranked.at(-1)?.status, 'excluded') })
  await test('Rejects replacement parts, deposits, empty cases and samples', () => { for (const name of ['replacement part', 'deposit', 'empty case', 'sample only']) { const value = clone(offer); value.skus[0].name = name; assert.equal(matches(value)[0].status, 'excluded') } })
  await test('Wrong voltage is not equivalent', () => { const value = clone(offer); value.skus[0].name += '; voltage: 110V'; const facts = interpretationFixture(value); facts.variants[0].facts.push({ field: 'voltage', value: '110V', quote: '110V' }); assert.equal(matches(value, { ...target, facts: [...target.facts, { field: 'voltage', value: '220V', quote: '220V' }] }, facts)[0].status, 'excluded') })
  await test('Wrong model is not equivalent', () => { const value = clone(offer); value.skus[0].name += '; model: X30'; const facts = interpretationFixture(value); facts.variants[0].facts.push({ field: 'model', value: 'X30', quote: 'X30' }); assert.equal(matches(value, { ...target, facts: [...target.facts, { field: 'model', value: 'X31', quote: 'X31' }] }, facts)[0].status, 'excluded') })
  await test('Missing AI or uncited material evidence never matches', () => { assert.equal(compareOffer(offer, target, 300, undefined)[0].applicablePrice, null); const bad = clone(interpreted); bad.variants[0].facts[1].quote = 'invented size'; assert.equal(matches(offer, target, bad)[0].status, 'possible') })
  await test('Invented quoted numbers and contradictory field interpretations are dropped', () => { assert.deepEqual(citedFacts([{ field: 'voltage', value: '220V', quote: '110V' }], '110V'), []); assert.deepEqual(citedFacts([{ field: 'size', value: '30cm', quote: '30cm' }, { field: 'size', value: '60cm', quote: '60cm' }], '30cm or 60cm'), []) })
  await test('Unknown target keeps the historical 11.50 inside an 8-12 range uncertain', () => { const value = clone(offer); value.price.min = 8; value.price.max = 12; const label = currentRangeLabel(value, { ...target, status: 'needs_confirmation' }, 300, interpreted); assert.match(label, /8\.00.*12\.00.*verify/); assert.doesNotMatch(label, /saving|unchanged|Matching variant/) })
  await test('Pack-of-two cannot masquerade as a single piece', () => { const value = clone(offer); value.skus[0].name += '; pack of 2'; assert.equal(commercial(value).price, null) })
  await test('Unknown MOQ, quantity, stock, unit or order multiple cannot be price-ready', () => { for (const field of ['stock', 'unit', 'quantityMultiple']) { const value = clone(offer); (value.skus[0] as any)[field] = null; if (field === 'quantityMultiple') { value.quantityMultiple = null; value.productProps = [] } if (field === 'unit') assert.equal(skuCommercialPrice(value, value.skus[0], target, 300).price, null); else assert.equal(commercial(value).price, null) }; assert.equal(commercial({ ...offer, moq: null }).price, null); assert.equal(commercial(offer, null).price, null) })
  await test('Enforces MOQ, SKU stock, exact multiples and whole quantities without changing quantity', () => { assert.equal(commercial(offer, 5).price, null); assert.equal(commercial(offer, 1001).price, null); assert.equal(commercial(offer, 2.5).price, null); const value = clone(offer); value.skus[0].quantityMultiple = 4; assert.equal(commercial(value, 301).price, null); assert.equal(commercial(value, 300).price, 9.5) })
  await test('No unpublished order multiple is guessed from the unit', () => { const raw = rawListing(); raw.product_props = []; assert.equal(normalizeListing(raw, raw.item_id).quantityMultiple, null); assert.equal(normalizeListing(raw, raw.item_id).skus[0].quantityMultiple, null) })
  await test('Respects the upper bound of SKU-specific quantity tiers', () => { const value = clone(offer); value.skus[0].tiers = [{ minQty: 10, maxQty: 299, price: 8, skuId: value.skus[0].id, source: 'SKU tier' }, { minQty: 300, maxQty: 499, price: 7.25, skuId: value.skus[0].id, source: 'SKU tier' }]; assert.equal(commercial(value).price, 7.25); assert.equal(commercial(value, 500).price, null) })
  await test('Contradictory equally applicable SKU prices remain unresolved', () => { const value = clone(offer); value.skus[0].tiers = [8, 9].map(price => ({ minQty: 10, maxQty: null, price, skuId: value.skus[0].id, source: 'SKU tier' })); assert.equal(commercial(value).price, null) })
  await test('A multiple-SKU listing ladder cannot replace a missing SKU price', () => { const raw = rawListing('888888000001', '9.50', 2); raw.skus[1].sale_price = ''; raw.tiered_price_info.prices = [{ begin_num: 10, price: '1' }] as any; const value = normalizeListing(raw, raw.item_id); assert.equal(compareOffer(value, target, 300, interpretationFixture(value)).find(row => row.skuId === 'sku-1')?.applicablePrice, null) })
  await test('A single-SKU ladder is demonstrably applicable', () => { const raw = rawListing(); raw.tiered_price_info.prices = [{ begin_num: 10, price: '7.75' }] as any; assert.equal(commercial(normalizeListing(raw, raw.item_id)).price, 7.75) })
  await test('A different returned offer or shop identity is rejected', () => { assert.throws(() => normalizeListing(rawListing(), '999999000001'), /another offer/); assert.throws(() => normalizeShop({ member_id: 'someone-else' }, 'wanted'), /different shop/) })
  await test('Overall supplier stars come only from the comprehensive rating', () => { const value = normalizeShop({ shop_ratings: [{ type: 'goods_quality_experience', score: '4.8' }] }, 'shop'); assert.equal(value.rating, null); assert.equal(value.ratings[0].score, 4.8); assert.equal(publishedNumber(''), null); assert.equal(publishedNumber(false), null) })
  await test('Image retrieval rejects private addresses, host lookalikes, credentials and ports', () => { for (const url of ['http://127.0.0.1/a.jpg', 'https://alicdn.com.evil.test/a.jpg', 'https://user:pass@cbu01.alicdn.com/a.jpg', 'https://cbu01.alicdn.com:1234/a.jpg', 'file:///etc/passwd']) assert.throws(() => trustedImage(url)); assert.equal(trustedImage('http://cbu01.alicdn.com/a.jpg').protocol, 'https:') })
  await test('Response limits reject overlarge bytes instead of truncating SKU evidence', async () => { await assert.rejects(boundedBytes(new Response('123456'), 5), /size limit/); assert.equal((await boundedBytes(new Response('12345'), 5)).length, 5) })

  fixture = await new ResearchFixture().init()
  const f = fixture
  const baseline = await f.businessHash()
  const aiContext = (await f.props()).contexts[testId(4)]
  const targetReply = { summary: target.summary, query: '黑色60厘米置物架', facts: target.facts, requiredFields: target.requiredFields, unit: null, packSize: null, unitQuote: null, uncertain: true, reason: 'Unit and pack evidence need confirmation.' }
  await test('Actual target AI uses the existing Google key directly, once, with bounded structured output', async () => {
    await withGoogleReply(googleReply(targetReply), async calls => {
      const result = await interpretTarget(aiContext)
      assert.equal(calls.length, 1)
      assert.equal(calls[0].generationConfig.maxOutputTokens, 2800)
      assert.equal(result.query, targetReply.query)
      assert.equal(result.target.status, 'needs_confirmation')
      assert.equal(result.target.unit, null)
      assert.equal(result.target.sourceSku, null)
      assert.ok(result.target.facts.some(fact => fact.field === 'size' && fact.value === '60cm'))
    })
  })
  await test('Actual Google SKU interpretation retains all 51 SKUs without transmitting commercial figures', async () => {
    const many = listingFixture('888888000001', '9.50', 51)
    await withGoogleReply(googleReply({ variants: interpretationFixture(many).variants }), async calls => {
      const result = await interpretOffer(many, target)
      assert.equal(calls.length, 1)
      assert.equal(calls[0].generationConfig.maxOutputTokens, 12000)
      const payload = JSON.parse(calls[0].contents[0].parts[0].text)
      assert.equal(payload.skus.length, 51)
      assert.ok(payload.skus.every((sku: Record<string, unknown>) => !('price' in sku) && !('stock' in sku)))
      assert.equal(result.variants.length, 51)
      const match = compareOffer(many, target, 300, result).find(value => value.status === 'matching')
      assert.equal(match?.skuId, 'sku-50')
      assert.equal(match?.applicablePrice, 9.5)
    })
  })
  await test('Actual Google output cannot add invented SKUs or verify duplicate and missing interpretations', async () => {
    const many = listingFixture('888888000001', '9.50', 3)
    const first = interpretationFixture(many).variants[0]
    await withGoogleReply(googleReply({ variants: [first, first, { ...first, skuId: 'invented-sku' }] }), async calls => {
      const result = await interpretOffer(many, target)
      assert.equal(calls.length, 1)
      assert.deepEqual(result.variants.map(value => value.skuId), many.skus.map(sku => sku.id))
      assert.ok(result.variants.every(value => value.kind === 'unknown' && value.facts.length === 0))
      assert.ok(compareOffer(many, target, 300, result).every(value => value.applicablePrice === null))
    })
  })
  await test('Missing Google configuration fails before network work and never falls back to Gateway', async () => {
    await withGoogleReply(googleReply(targetReply), async calls => {
      delete process.env.GOOGLE_AI_API_KEY
      await assert.rejects(interpretTarget(aiContext), (cause: unknown) => cause instanceof Provider1688Error && cause.terminal && /Google AI key.*unavailable/.test(cause.message))
      assert.equal(calls.length, 0)
    })
  })
  for (const [status, providerStatus, expected] of [[401, 'UNAUTHENTICATED', /key or permissions/], [403, 'PERMISSION_DENIED', /key or permissions/], [402, 'PAYMENT_REQUIRED', /billing needs attention/], [429, 'RESOURCE_EXHAUSTED', /quota or rate limit/], [404, 'NOT_FOUND', /model is unavailable/], [400, 'INVALID_ARGUMENT', /rejected the specification request/]] as const) {
    await test(`Google HTTP ${status} is actionable, stops paid work, and never retries or falls back`, async () => {
      await withGoogleReply({ error: { code: status, status: providerStatus, message: 'Provider diagnostic containing isolated-google-key must stay private' } }, async calls => {
        await assert.rejects(interpretTarget(aiContext), (cause: unknown) => {
          assert.ok(cause instanceof Provider1688Error)
          assert.equal(cause.terminal, true)
          assert.equal(cause.reason, 'ai-provider')
          assert.match(cause.message, expected)
          assert.match(cause.message, new RegExp(`HTTP ${status}`))
          assert.doesNotMatch(cause.message, /isolated-google-key|Provider diagnostic/)
          return true
        })
        assert.equal(calls.length, 1)
      }, status)
    })
  }
  await test('A Google server failure is not retried and never becomes a verified specification', async () => {
    await withGoogleReply({ error: { code: 503, status: 'UNAVAILABLE', message: 'Service temporarily unavailable' } }, async calls => {
      await assert.rejects(interpretOffer(offer, target), (cause: unknown) => cause instanceof Provider1688Error && !cause.terminal && /Google AI.*HTTP 503/.test(cause.message))
      assert.equal(calls.length, 1)
    }, 503)
  })
  await test('Invalid Google structured output stays unverified without a repair generation', async () => {
    await withGoogleReply(googleReply({ variants: 'invalid' }), async calls => {
      await assert.rejects(interpretOffer(offer, target), (cause: unknown) => cause instanceof Provider1688Error && !cause.terminal && /Missing evidence remains unverified/.test(cause.message))
      assert.equal(calls.length, 1)
    })
  })
  const note = (overrides: Record<string, unknown> = {}) => ({ name: 'QA Original Supplier', revision: 0, rating: 2, body: 'Motor casing defect recorded for this controlled test batch.', kind: 'defect' as const, productId: testId(2), importId: testId(3), requestKey: randomUUID(), ...overrides })
  let firstNote = note()
  await test('Real save-note service atomically records rating, author, date and import captions', async () => { const saved = await appendSupplierNote(f.db, ACTOR, firstNote); assert.equal(saved.internalRating, 2); assert.equal(saved.defectCount, 1); assert.equal(saved.revision, 1); const page = await readQualityPage(f.db, firstNote.name, null); assert.equal(page.notes[0].authorName, 'QA Buyer'); assert.equal(page.notes[0].importCaption, 'QA-1'); assert.equal(page.notes[0].productCaption, 'Black Storage Rack'); assert.equal(page.notes[0].ratingChanged, true) })
  await test('Replaying the actual note payload does not create a second note', async () => { const saved = await appendSupplierNote(f.db, ACTOR, firstNote); assert.equal(saved.noteCount, 1); assert.equal(saved.revision, 1); await assert.rejects(appendSupplierNote(f.db, ACTOR, { ...firstNote, body: 'Different request content' }), /Request key/) })
  await test('A stale second buyer cannot overwrite an internal rating', async () => { await assert.rejects(appendSupplierNote(f.db, OTHER_BUYER, note({ body: 'Stale buyer note', rating: 5 })), /Supplier changed/); assert.equal((await readQualityPage(f.db, firstNote.name, null)).summary?.internalRating, 2) })
  await test('A wrong import/product association rolls back the complete note operation', async () => { await assert.rejects(appendSupplierNote(f.db, ACTOR, note({ revision: 1, importId: testId(3, 1) })), /another supplier/); await assert.rejects(appendSupplierNote(f.db, ACTOR, note({ revision: 1, productId: testId(2, 1) })), /does not match/); assert.equal((await readQualityPage(f.db, firstNote.name, null)).summary?.noteCount, 1) })
  await test('Invalid rating, blank note and wrong-role writes are denied', async () => { await assert.rejects(appendSupplierNote(f.db, ACTOR, note({ rating: 6 }))); await assert.rejects(appendSupplierNote(f.db, ACTOR, note({ body: '' }))); await assert.rejects(appendSupplierNote(f.db, WRONG_ROLE, note({ revision: 1 }))); assert.equal((await readQualityPage(f.db, firstNote.name, null)).summary?.noteCount, 1) })
  await test('An exact unambiguous shop identity attaches without changing human quality fields', async () => { const shop = normalizeShop({ company_name: firstNote.name, shop_ratings: [{ type: 'comprehensive', score: '4.7' }] }, 'qa-original-member', stamp); await observeSupplier(f.db, ACTOR, shop, f.catalogue.suppliers); const saved = (await loadSupplierQuality(f.db))[0]; assert.equal(saved.memberId, 'qa-original-member'); assert.equal(saved.platformRating, 4.7); assert.equal(saved.internalRating, 2); assert.equal(saved.revision, 1) })
  await test('Older observations cannot overwrite newer stars and failed attempts keep the old date', async () => { const baseShop = normalizeShop({ shop_ratings: [{ type: 'comprehensive', score: '4.9' }] }, 'qa-original-member', '2026-09-02T10:00:00.000Z'); await observeSupplier(f.db, ACTOR, baseShop, []); await observeSupplier(f.db, ACTOR, { ...baseShop, observedAt: stamp, rating: 1 }, []); await observeSupplier(f.db, ACTOR, { ...baseShop, observedAt: '2026-09-03T10:00:00.000Z', rating: null, error: 'Unreachable in isolated test' }, []); const saved = (await loadSupplierQuality(f.db))[0]; assert.equal(saved.platformRating, 4.9); assert.equal(saved.platformObservedAt, '2026-09-02T10:00:00.000Z'); assert.equal(saved.platformStatus, 'unavailable'); assert.equal(saved.internalRating, 2) })
  await test('Similar supplier names do not share notes or create guessed directory entries', async () => { await appendSupplierNote(f.db, ACTOR, note({ name: 'QA Similar Supplier', productId: null, importId: null })); await observeSupplier(f.db, ACTOR, normalizeShop({ company_name: 'QA Similar' }, 'unmatched-shop'), f.catalogue.suppliers); const quality = await loadSupplierQuality(f.db); const value = { ...offer, supplier: { name: 'QA Similar Supplier Ltd', memberId: 'unmatched-shop' } }; assert.equal(matchingQuality(value, quality), null); assert.equal(quality.length, 2) })
  await test('Unknown and ambiguous exact names are not automatically merged', async () => { await observeSupplier(f.db, ACTOR, { ...normalizeShop({}, 'ambiguous'), names: ['QA Similar Supplier', 'QA Similar Supplier Ltd'] }, f.catalogue.suppliers); assert.equal((await loadSupplierQuality(f.db)).find(row => row.memberId === 'ambiguous'), undefined) })
  await test('New profile creation rolls back if the caller gives a stale initial revision', async () => { await assert.rejects(appendSupplierNote(f.db, ACTOR, note({ name: 'QA Similar Supplier Ltd', productId: null, importId: null, revision: 4 }))); assert.equal((await loadSupplierQuality(f.db)).some(row => row.name === 'QA Similar Supplier Ltd'), false) })
  await test('History pagination preserves all 27 dated notes without duplication', async () => { for (let revision = 1; revision < 27; revision++) await appendSupplierNote(f.db, ACTOR, note({ revision, kind: 'general', body: `Dated follow-up ${revision}`, rating: 2 })); const page = await readQualityPage(f.db, firstNote.name, null); const older = await readQualityPage(f.db, firstNote.name, page.nextCursor); assert.equal(page.notes.length, 25); assert.equal(older.notes.length, 2); assert.equal(new Set([...page.notes, ...older.notes].map(row => row.id)).size, 27); assert.equal(page.summary?.defectCount, 1) })
  await test('Buyer RLS reads and direct mutation grants are enforced', async () => {
    await f.sql.query("select set_config('test.actor',$1,false)", [WRONG_ROLE]); await f.sql.exec('set role authenticated')
    try { assert.equal((await f.sql.query('select id from public.foreign_supplier_profiles')).rows.length, 0); await assert.rejects(f.sql.query("update public.foreign_supplier_profiles set internal_rating=5"), /permission denied/); await assert.rejects(f.sql.query('select public.foreign_supplier_identity($1,$2,null,$3,false)', [ACTOR, firstNote.name, '[]']), /permission denied/) }
    finally { await f.sql.exec('reset role') }
    await f.sql.query("select set_config('test.actor',$1,false)", [ACTOR]); await f.sql.exec('set role authenticated')
    try { assert.equal((await f.sql.query('select id from public.foreign_supplier_profiles')).rows.length, 2) } finally { await f.sql.exec('reset role') }
    await f.sql.exec('set role service_role'); try { await assert.rejects(f.sql.query("update public.foreign_supplier_quality_notes set body='rewritten'"), /permission denied/); await assert.rejects(f.sql.query('delete from public.foreign_supplier_quality_notes'), /permission denied/) } finally { await f.sql.exec('reset role') }
  })
  await test('Starting research saves state without making a provider or AI call', async () => { const before = f.providerCalls.length; const command = await f.command(); const result = await f.process(command); assert.equal(result.check.status, 'running'); assert.equal(f.providerCalls.length, before); const replay = await f.process(command); assert.equal(replay.check.generation, result.check.generation) })
  await test('Duplicate stage requests spend once and lose atomically rather than racing', async () => { const command = await f.command(0, 'next'); const results = await Promise.allSettled([f.process(command), f.process(command)]); assert.equal(results.filter(value => value.status === 'fulfilled').length, 1); assert.equal(f.providerCalls.filter(value => value === 'listing:888888000000').length, 1) })
  await test('Anonymous and wrong-role commands fail before any provider work', async () => { const before = f.providerCalls.length; await assert.rejects(f.process(await f.command(1), WRONG_ROLE)); await assert.rejects(f.process(await f.command(1), testId(99))); assert.equal(f.providerCalls.length, before) })
  await test('Fabricated context, client findings and unknown item IDs are rejected', async () => { const command = await f.command(1); await assert.rejects(processResearchCommand(f.db, ACTOR, { ...command, evidence: {} }, f.ports), researchFailure(400)); await assert.rejects(f.process({ ...command, itemId: testId(99) }), researchFailure(404)); await assert.rejects(f.process({ ...command, revision: 999 }), researchFailure(409)) })
  await test('Stop and explicit resume reuse the already-saved listing', async () => { await f.process(await f.command(0, 'stop')); const calls = f.providerCalls.filter(value => value === 'listing:888888000000').length; const result = await f.run(0, 'resume'); assert.equal(result.status, 'complete'); assert.equal(f.providerCalls.filter(value => value === 'listing:888888000000').length, calls); assert.equal(Object.keys(result.evidence.offers).length, 5); assert.equal(result.evidence.target.status, 'needs_confirmation') })
  await test('The complete staged pipeline stays inside both advertised paid-call caps', async () => { const check = (await f.check())!; assert.ok(check.evidence.paid.tmapi <= CHECK_LIMITS.tmapiCalls); assert.equal(check.evidence.paid.ai, 7); assert.equal(f.providerCalls.filter(value => value === 'shop:qa-alternative-member').length, 1) })
  await test('Buyer target confirmation recomputes a 9.50 match with no paid request or financial mutation', async () => { const before = f.providerCalls.length; const command = await f.command(0, 'confirm-target', { target: { sourceSku: { offerId: '888888000001', skuId: 'sku-50' }, specification: '', unit: 'piece', packSize: 1 } }); const result = await f.process(command); assert.equal(result.check.evidence.findings[0].applicablePrice, 9.5); assert.equal(f.providerCalls.length, before); assert.equal(await f.businessHash(), baseline) })
  await test('Reload restores the same confirmed target and saved findings as current', async () => { const props = await f.props(); const saved = props.initialChecks.find(value => value.item_id === testId(4))!; assert.equal(saved.isCurrent, true); assert.ok(sameBaseContext(saved.context, props.contexts[testId(4)])); assert.equal(props.contexts[testId(4)].comparisonTarget?.sourceSku?.skuId, 'sku-50') })
  await test('Parcel fee 4.50 and whole-order shipment 45 never become a freight-saving claim', async () => { const check = (await f.check())!; assert.equal(check.evidence.current?.freight.fee, 4.5); assert.equal(check.context.savedItem.chinaFreight, 45); assert.doesNotMatch(check.evidence.remarks.join(' '), /freight.*saving|90%|landed.*sav/i) })
  await test('A bad refresh keeps the previous successful snapshot and its original date', async () => { const original = (await f.check())!.previous_success; f.failStage = 'listing:888888000000'; f.terminal = true; const result = await f.run(); assert.equal(result.status, 'failed'); assert.deepEqual(result.previous_success, original); assert.equal(result.evidence.paid.tmapi, 1); f.terminal = false })
  await test('Missing source link still searches alternatives from the saved product', async () => { const before = f.providerCalls.length; const result = await f.run(5); assert.equal(result.evidence.currentStatus, 'missing-link'); assert.equal(Object.keys(result.evidence.offers).length, 5); const calls = f.providerCalls.slice(before); assert.ok(calls.indexOf('search:keyword') < calls.indexOf('listing:888888000000'), 'The original offer may be discovered as an alternative, but no source lookup is attempted before searching') })
  await test('A gone source listing still allows alternative searching', async () => { const command = await f.command(1); const started = await f.process(command); const ports = { ...f.ports, provider: { ...f.ports.provider, listing: async () => { throw new Provider1688Error('Listing gone', 'gone', false) } } }; const result = await executeResearchStage(started.check, 'listing', ports); assert.equal(result.evidence.currentStatus, 'gone'); assert.equal(result.stopReason, undefined); const search = await executeResearchStage({ ...started.check, evidence: result.evidence }, 'keyword-search', f.ports); assert.ok(search.evidence.searchHits.length) })
  await test('An in-flight lookup may finish after stop, but no next lookup is started', async () => { f.delay = 50; const next = f.process(await f.command(1, 'next')); while (!f.providerActive) await new Promise(resolve => setTimeout(resolve, 2)); await f.process(await f.command(1, 'stop')); const result = await next; assert.equal(result.check.status, 'partial'); const count = f.providerCalls.length; await f.process(await f.command(1, 'next')); assert.equal(f.providerCalls.length, count); f.delay = 0 })
  await test('Database claims enforce one shared three-worker ceiling across tabs', async () => {
    for (const index of [1, 2, 3, 4]) { const prior = await f.check(index); if (prior) await f.process(await f.command(index, 'stop')); await f.process(await f.command(index, 'start', { mode: prior ? 'resume' : 'fresh' })) }
    f.delay = 80; f.maxProviderActive = 0
    const commands = await Promise.all([1, 2, 3, 4].map(index => f.command(index, 'next')))
    const results = await Promise.all(commands.map(command => f.process(command)))
    assert.equal(results.filter(value => value.busy).length, 1); assert.ok(f.maxProviderActive <= 3)
    f.delay = 0; for (const index of [1, 2, 3, 4]) await f.process(await f.command(index, 'stop'))
  })
  await test('Search failure remains partial; explicit retry does not refetch successful details', async () => { f.failStage = 'search:keyword'; const failed = await f.run(2, 'resume'); assert.equal(failed.status, 'partial'); const originalLookups = f.providerCalls.filter(value => value === 'listing:888888000000').length; const done = await f.run(2, 'resume'); assert.equal(done.status, 'complete'); assert.equal(f.providerCalls.filter(value => value === 'listing:888888000000').length, originalLookups) })
  await test('Shop failure is reused as a failure within a run and retried only on explicit resume', async () => { f.failStage = 'shop:qa-alternative-member'; const before = f.providerCalls.filter(value => value === 'shop:qa-alternative-member').length; const partial = await f.run(3, 'resume'); assert.equal(partial.status, 'partial'); assert.equal(f.providerCalls.filter(value => value === 'shop:qa-alternative-member').length - before, 1); const done = await f.run(3, 'resume'); assert.equal(done.status, 'complete'); assert.equal(f.providerCalls.filter(value => value === 'shop:qa-alternative-member').length - before, 2) })
  await test('Storage failure returns checked-but-not-saved evidence without claiming completion', async () => { await f.process(await f.command(4, 'start', { mode: 'resume' })); f.failRpc = 'complete'; await assert.rejects(f.process(await f.command(4, 'next')), (cause: unknown) => cause instanceof ResearchError && cause.checkedButNotSaved && cause.status === 503); const stored = (await f.check(4))!; assert.ok(stored.lease_key); assert.notEqual(stored.status, 'complete') })
  await test('Stale supplier generations and fabricated offer mappings cannot change quality identity', async () => { await assert.rejects(confirmSupplierIdentity(f.db, ACTOR, { itemId: testId(4), generation: 999, offerId: offer.offerId, supplierName: 'QA Original Supplier', confirmed: true }), /changed/); const check = (await f.check(5))!; await assert.rejects(confirmSupplierIdentity(f.db, ACTOR, { itemId: check.item_id, generation: check.generation, offerId: '999999999999', supplierName: 'QA Original Supplier', confirmed: true }), /no verified shop/) })
  await test('Actual pipeline and note services leave every purchasing, product, cost and stock record unchanged', async () => assert.equal(await f.businessHash(), baseline))
  await test('Source-product edits during a lookup discard its delayed result', async () => { const check = await f.process(await f.command(1, 'start', { mode: 'fresh' })); f.afterProvider = async () => { await f.sql.query('update public.products set description=$1 where id=$2', ['Different evidence', check.check.context.productId]) }; await assert.rejects(f.process(await f.command(1, 'next')), researchFailure(409)) })
  await test('Changed, removed and re-added rows cannot hydrate old results as current', async () => { await f.sql.query("update public.import_reorder_items set revision=revision+1,item=jsonb_set(item,'{qty}','301') where id=$1", [testId(4)]); const props = await f.props(); assert.equal(props.initialChecks.find(check => check.item_id === testId(4))?.isCurrent, false); await f.sql.query("update public.import_reorder_items set status='excluded' where id=$1", [testId(4)]); await assert.rejects(f.process(await f.command()), researchFailure(404)); await f.sql.query("update public.import_reorder_items set status='active',revision=revision+1 where id=$1", [testId(4)]); assert.equal((await f.props()).initialChecks.find(check => check.item_id === testId(4))?.isCurrent, false) })
  await test('All recorded research reads and writes remain within the approved boundaries', () => { assert.equal(f.reads.some(table => /deliver|payment|customer|local_|stock/.test(table)), false); assert.equal(f.writes.some(operation => /accept|order_mutate|purchase|stock/.test(operation)), false) })
  await test('Migration functions use the same source that is exercised by the app services', async () => { const sql = await readFile(new URL('./create-supplier-quality-and-1688-checks.sql', import.meta.url), 'utf8'); const bodies = [...sql.matchAll(/create function public\.(\w+)\([^]*?as \$\$([^]*?)\$\$;/g)].map(match => ({ name: match[1], md5: createHash('md5').update(match[2]).digest('hex') })); const { rows } = await f.sql.query("select proname,md5(prosrc) as md5,prosecdef from pg_proc where proname in ('foreign_supplier_identity','foreign_supplier_save_note','foreign_supplier_observe','import_reorder_1688_transition') order by proname"); assert.equal(rows.length, 4); for (const row of rows) { assert.equal(row.md5, bodies.find(value => value.name === row.proname)?.md5); assert.equal(row.prosecdef, false) }; console.log('Migration body hashes:', JSON.stringify(bodies)) })
} finally {
  await fixture?.close()
  globalThis.fetch = originalFetch
}
const failed = results.filter(result => !result.ok)
console.log(`\nIsolated research checks: ${results.length - failed.length} passed, ${failed.length} failed. No live data or paid provider calls.`)
if (failed.length) { for (const result of failed) console.error(result.error); process.exitCode = 1 }
