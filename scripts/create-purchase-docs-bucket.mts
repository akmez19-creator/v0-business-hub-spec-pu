/**
 * Creates the PRIVATE storage bucket that holds local purchase documents.
 *
 * WHY THIS SCRIPT EXISTS: `importPurchaseDocumentAction` wraps the upload in a
 * try/catch so that a storage failure never throws away an extraction the owner
 * is already waiting on. That is the right behaviour, but it also means a
 * MISSING BUCKET would be completely silent - every receipt would be read,
 * every purchase would save, and not one document would ever be kept. I only
 * found this by listing the buckets instead of assuming "documents" existed.
 *
 * Private, following the existing `payment-proofs` precedent: a supplier
 * invoice carries prices, VAT numbers and trading terms, so it must never be
 * world-readable like `product-images`.
 */
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'purchase-docs'

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const { data: existing, error: listErr } = await db.storage.listBuckets()
if (listErr) throw new Error(`Could not list buckets: ${listErr.message}`)

const found = existing.find((b) => b.name === BUCKET)
const options = {
  public: false,
  fileSizeLimit: 20 * 1024 * 1024,
  allowedMimeTypes: [
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel.sheet.macroEnabled.12', 'application/vnd.ms-excel', 'text/csv',
  ],
}
const { error: setupError } = found
  ? await db.storage.updateBucket(BUCKET, options)
  : await db.storage.createBucket(BUCKET, options)
if (setupError) throw new Error(`Could not configure ${BUCKET}: ${setupError.message}`)
console.log(`${BUCKET}: private, 20MB cap, supported photos, PDF, Excel and CSV`)
if (process.argv.includes('--configure-only')) process.exit(0)

/*
 * PROVE it works, rather than trusting the create call. A bucket that exists
 * but refuses uploads is the same silent failure in a different costume.
 */
const probePath = `__probe/${Date.now()}.pdf`
const { error: upErr } = await db.storage
  .from(BUCKET)
  .upload(probePath, Buffer.from('%PDF-1.4 probe'), { contentType: 'application/pdf' })
console.log(upErr ? `UPLOAD FAILED: ${upErr.message}` : 'upload probe: ok')

if (!upErr) {
  const { data: signed } = await db.storage.from(BUCKET).createSignedUrl(probePath, 60)
  console.log(signed?.signedUrl ? 'signed url probe: ok' : 'signed url probe: FAILED')
  await db.storage.from(BUCKET).remove([probePath])
  console.log('probe file removed')
}

// A rejected type must actually be rejected, or the cap is decoration.
const { error: badErr } = await db.storage
  .from(BUCKET)
  .upload(`__probe/${Date.now()}.exe`, Buffer.from('MZ'), { contentType: 'application/x-msdownload' })
console.log(
  badErr ? `disallowed mime correctly refused (${badErr.message})` : 'WARNING: .exe was accepted',
)
