'use client'

/**
 * Local PURCHASE entry, with the import cross-check attached to every line.
 *
 * This records money actually spent with a local supplier, against the receipt
 * or invoice itself - it is not a quote stage. The screen's job: show what the
 * same product costs to import and how much is already in the warehouse, so a
 * bad local price is visible. It WARNS and never blocks (owner's call) - local
 * can still be the right choice on lead time, MOQ or cash flow.
 *
 * Only imports from `lib/local-purchasing/vat` and `repeats` (both pure).
 * `costs.ts` and `suggest.ts` reach for the admin Supabase client and would
 * crash the browser.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { evidenceRevision, normaliseEvidence, nullableNumber, type ReceiptEvidence, type ReceiptLine } from '@/lib/local-purchasing/evidence'
import { reconcileReceipt, type ReceiptOverrides } from '@/lib/local-purchasing/reconcile'
import { draftEvidence, comparableEvidence, purchaseReviewRevision } from '@/lib/local-purchasing/receipt-input'
import { ReceiptCheckSummary, ReceiptIssues } from './receipt-check'
import { ReceiptEvidenceEditor, ReceiptLineEvidenceEditor } from './receipt-evidence-editor'
import { PurchaseAcknowledgement } from './purchase-acknowledgement'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Loader2,
  Minus,
  Package,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ProductThumb } from '@/components/ui/product-thumb'
import { cn } from '@/lib/utils'
import { round2, type VatBasis, type Verdict } from '@/lib/local-purchasing/vat'
import { summariseRepeats, sameDescriptionKeys } from '@/lib/local-purchasing/repeats'
import { ExistingVariantPicker, ProductPicker, type PickableProduct } from '@/components/local-purchasing/product-picker'
import {
  CreateProductDialog,
  type CreateProductRequest,
  type CreateProductOutcome,
} from '@/components/local-purchasing/create-product-dialog'
import {
  analyseLinesAction,
  createSupplierAction,
  findExistingPurchaseAction,
  savePurchaseAction,
  type AnalysedLine,
  type DraftLineInput,
  type ImportedDoc,
  type LineMatchMethod,
} from '@/app/dashboard/purchasing/local/actions'
import { DocumentImport } from './document-import'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ProductPricingDialog, ProductPricingStatus, type ProductPricingRequest } from './product-pricing-dialog'
import { clearedVariant, mergePricingProducts, variantSelectionError, type PricingProduct, type VariantSelection } from '@/lib/products/pricing'
import { getPurchasingCatalogueAction } from '@/app/dashboard/purchasing/local/actions'
import { SupplierUnitCost } from './supplier-unit-cost'

export interface SupplierOption {
  id: string
  name: string
  vatNumber: string | null
  phone: string | null
  paymentTermsDays: number | null
}

interface DraftLine extends VariantSelection {
  key: string
  supplierLabel: string
  supplierCode: string
  unit: string
  evidence?: ReceiptLine
  lineTotal: string
  qty: string
  unitPriceGross: string
  productId: string | null
  productName: string | null
  /** How this link came about - stored with the line, never inferred later. */
  matchMethod: LineMatchMethod | null
  /**
   * Set when a PERSON deliberately removed the link.
   *
   * Without this, automatic linking makes "Change" impossible: clearing the
   * product re-runs the analysis, the analysis still says the top candidate is
   * decisive, and the link snaps straight back. Automation must never overrule
   * an explicit human decision - so a cleared line is left alone until the
   * label itself is edited.
   */
  linkCleared?: boolean
}

type ScopedAnalysis = { value: AnalysedLine; lineRevision: string; termsRevision: string }

function lineAnalysisRevision(line: VariantSelection & {
  supplierLabel: string; supplierCode?: string | null; qty: string | number | null;
  unitPriceGross: string | number | null; productId?: string | null; matchMethod?: LineMatchMethod | null;
  discountPercent?: number | null; unit?: string | null; evidence?: ReceiptLine; lineTotal?: string | number | null;
}) {
  return JSON.stringify([line.supplierLabel, line.supplierCode || null, Number(line.qty) || 0,
    Number(line.unitPriceGross) || 0, line.productId || null, line.matchMethod || null, line.discountPercent ?? null,
    line.unit || null, nullableNumber(line.lineTotal), line.evidence ?? null,
    line.variantId || null, line.variantSource || null, line.variantCleared === true])
}

const termsAnalysisRevision = (discount: number, vat: number, reclaimable: boolean, inclusive: boolean, supplier: string) =>
  JSON.stringify([discount, vat, reclaimable, inclusive, supplier])

const rs = (n: number) =>
  'Rs ' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

let seq = 0
const blankLine = (): DraftLine => ({
  key: `l${++seq}`,
  supplierLabel: '',
  supplierCode: '',
  unit: '',
  lineTotal: '',
  qty: '',
  unitPriceGross: '',
  productId: null,
  productName: null,
  matchMethod: null,
})

const draftInputs = (lines: DraftLine[]): DraftLineInput[] => lines.map((line) => ({
  key: line.key, supplierLabel: line.supplierLabel, supplierCode: line.supplierCode || null, unit: line.unit || null,
  qty: nullableNumber(line.qty), unitPriceGross: nullableNumber(line.unitPriceGross), lineTotal: nullableNumber(line.lineTotal),
  evidence: line.evidence, productId: line.productId, matchMethod: line.matchMethod,
  variantId: line.variantId ?? null, variantSource: line.variantSource ?? null, variantCleared: line.variantCleared === true,
}))
type ReviewContext = { document: ReceiptEvidence; overrides: ReceiptOverrides; supplierId: string }

/** Colour and words per verdict. Only three states get a colour, deliberately. */
const VERDICT: Record<Verdict, { label: string; className: string; icon: typeof ArrowUp }> = {
  local_cheaper: {
    label: 'Cheaper than importing',
    className: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
    icon: ArrowDown,
  },
  local_dearer: {
    label: 'Dearer than importing',
    className: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
    icon: ArrowUp,
  },
  comparable: {
    label: 'Same price',
    className: 'text-sky-400 border-sky-500/30 bg-sky-500/10',
    icon: Minus,
  },
  no_china_history: {
    label: 'Never imported',
    className: 'text-muted-foreground border-border bg-muted/40',
    icon: Package,
  },
  unlinked: {
    label: 'Not linked yet',
    className: 'text-muted-foreground border-dashed border-border bg-transparent',
    icon: Search,
  },
}

/**
 * Loose comparison key for supplier names and VAT numbers: case and punctuation
 * ignored, so "MORIS TRADING LTD." and "Moris Trading Ltd" are one firm and
 * "VAT 2012 3456" is "VAT20123456". One definition, used by both the mismatch
 * warning and the document-supplier offer, so they cannot disagree.
 */
const cleanKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * VAT/BRN numbers compare by DIGITS ONLY: "VAT 2846-1839" on our record and
 * "28461839" on the invoice are the same registration. Letters are the form's
 * label, not the identity. Empty when there are no digits, so a digit-less
 * value never "matches" another digit-less value.
 */
const vatKey = (s: string) => s.replace(/\D/g, '')

export function PurchaseEntry({
  suppliers,
  products: initialProducts,
}: {
  suppliers: SupplierOption[]
  /** The whole catalogue, for picking a product the ranking did not offer. */
  products: PickableProduct[]
}) {
  const { data: products = initialProducts, mutate: refreshCatalogue, error: catalogueError, isValidating: catalogueRefreshing } = useSWR(
    'local-purchasing-catalogue',
    getPurchasingCatalogueAction,
    { fallbackData: initialProducts, revalidateOnMount: true, shouldRetryOnError: false },
  )
  const productsById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products])
  const rememberProduct = useCallback((product: PricingProduct) => {
    void refreshCatalogue((current) => mergePricingProducts(current ?? initialProducts, [product]), false)
  }, [refreshCatalogue, initialProducts])
  const [pricingRequest, setPricingRequest] = useState<ProductPricingRequest | null>(null)
  const [supplierList, setSupplierList] = useState(suppliers)
  const [supplierId, setSupplierId] = useState('')
  const [showNewSupplier, setShowNewSupplier] = useState(false)
  const [newSupplier, setNewSupplier] = useState({ name: '', vatNumber: '', phone: '' })

  const [docRef, setDocRef] = useState('')
  const [purchaseDate, setPurchaseDate] = useState('')
  const [discountPercent, setDiscountPercent] = useState('')
  const [vatPercent, setVatPercent] = useState('15')
  const [evidence, setEvidence] = useState<ReceiptEvidence | null>(null)
  const [discountTreatment, setDiscountTreatment] = useState<ReceiptOverrides['discountTreatment']>(null)
  const [actualPurchase, setActualPurchase] = useState(false)
  const [acknowledgement, setAcknowledgement] = useState<{ revision: string; reason: string } | null>(null)
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())
  const [importBusy, setImportBusy] = useState(false)

  const [lines, setLines] = useState<DraftLine[]>([blankLine()])
  const [analysisAnswers, setAnalysis] = useState<Record<string, ScopedAnalysis>>({})
  const analysisVersion = useRef(0)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  /** Which line is having a product created, so only its button spins. */
  /** The line the create dialog is open for; null when closed. */
  const [creating, setCreating] = useState<CreateProductRequest | null>(null)
  /** Plain confirmation of something that changed the catalogue, not an error. */
  const [notice, setNotice] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ id: string; message: string } | null>(null)

  /*
   * What the imported document said, kept SEPARATE from the lines.
   *
   * `declaredTotal` is the total printed on the receipt. Holding it apart from
   * the lines is the whole point: if the lines do not add up to it, a line was
   * missed or misread, and only comparing the two can reveal that. Merging them
   * would destroy the evidence.
   */
  const [imported, setImported] = useState<ImportedDoc | null>(null)

  const supplier = supplierList.find((s) => s.id === supplierId) ?? null
  /*
   * NO VAT NUMBER MEANS NO RECLAIM.
   *
   * This single boolean changes what every comparison on the screen means. A
   * registered supplier's VAT comes back from the MRA, so the comparable cost is
   * the net price; an unregistered supplier's price is the whole cost. Derived
   * from the supplier record rather than a checkbox, so it cannot be set to the
   * flattering answer by accident.
   */
  const vatReclaimable = Boolean(supplier?.vatNumber)

  /**
   * Edits one line - and DROPS any automatic link when the description changes.
   *
   * MEASURED BUG this fixes: with the line auto-linked to "Sweeping Robot", I
   * retyped the description as "Robot Cleaner Empty Pads" and re-checked. The
   * screen still said AUTO-LINKED / Sweeping Robot, because the link was
   * derived from the OLD text and nothing invalidated it. The cost comparison,
   * the stock note and the saved product_id would all have belonged to a
   * product the buyer had just typed away from.
   *
   * This is the same class of bug as the Entry Activity filter and the VAT
   * reclaim figure: derived values must be invalidated by every input that
   * feeds them. Doing it inside `setLine` means no caller can forget.
   *
   * A link the PERSON chose is also dropped, deliberately - it was a decision
   * about different words, so it is no longer known to be right. `matchMethod`
   * is cleared too, otherwise a re-link would keep claiming it was automatic.
   * `linkCleared` is reset for the same reason: "not that one" was said about
   * the OLD words, and leaving it set meant a retyped line could never be
   * auto-linked again.
   *
   * AND THEN RE-CHECKS, BY ITSELF. The owner's screenshot: "normally when
   * typing the correct name, its becoming black for that particular line" -
   * line 5 retyped as "Toothpaste Niacinamide", and under it nothing: no link,
   * no comparison, no candidates, NET/UNIT showing "-". The invalidation above
   * was working exactly as designed and nothing ever ran the check again; the
   * row stayed dark until "Check against imports" was pressed. Same lesson
   * as the import: A STEP THAT WAITS FOR A CLICK DOES NOT HAPPEN. So every
   * edit that feeds the analysis schedules it, debounced to the typing pause.
   *
   * QUANTITY AND PRICE were the OPPOSITE failure, unreported and worse: they
   * did not invalidate at all, so after changing 140 to 150 the row kept
   * saying "Rs 43.48" net and "+Rs 11,979.24 on 364" about the old price -
   * the sixth stale-derived-money bug in this file. Both feed every figure on
   * the row, so both drop it and re-check like the description does. The
   * LINK survives a price edit, though: the product is still the product.
   */
  const setLine = (key: string, patch: Partial<DraftLine>) => {
    /*
     * Read "did the text change?" from the CURRENT lines via the ref, not from
     * inside the setLines updater.
     *
     * MY BUG, caught in the browser: I set a `relabelled` flag inside the
     * updater and read it straight after. React defers the updater, so the flag
     * was still false and the stale analysis was never cleared - the link
     * disappeared but "2572.7% dearer" stayed on screen. An updater's body has
     * not run yet when the next statement executes.
     */
    const current = linesRef.current.find((l) => l.key === key)
    const recoded = patch.supplierCode !== undefined && patch.supplierCode !== current?.supplierCode
    const relabelled = (patch.supplierLabel !== undefined && patch.supplierLabel !== current?.supplierLabel) || recoded ||
      (patch.unit !== undefined && patch.unit !== current?.unit)
    const repriced =
      (patch.qty !== undefined && patch.qty !== current?.qty) ||
      (patch.unitPriceGross !== undefined && patch.unitPriceGross !== current?.unitPriceGross) ||
      patch.lineTotal !== undefined || patch.evidence !== undefined

    const reselected = patch.variantId !== undefined || patch.variantSource !== undefined || patch.variantCleared !== undefined
    const reparented = patch.productId !== undefined && patch.productId !== current?.productId
    const nextLines = linesRef.current.map((l) =>
      l.key === key
        ? relabelled
          ? { ...l, ...patch, ...clearedVariant, productId: null, productName: null, matchMethod: null, linkCleared: false }
          : { ...l, ...patch, ...(reparented ? clearedVariant : {}) }
        : l,
    )
    linesRef.current = nextLines
    setLines(nextLines)
    /*
     * The comparison is keyed by line key, which does NOT change when the text
     * does - so "2572.7% dearer than importing" would go on describing the old
     * product under the new description (or the old price). Drop this line's
     * row only; the other lines' analyses are still valid.
     */
    if (relabelled || repriced || reselected || reparented) {
      setAnalysis((prev) => {
        if (!prev[key]) return prev
        const next = { ...prev }
        delete next[key]
        return next
      })
    }
    // The code feeds matching but not money: nothing to drop, but the
    // candidates may change, so it is worth a re-check once typing stops.
    if (relabelled || repriced || recoded || reselected || reparented) scheduleRecheck()
  }

  /**
   * Re-runs the check once the buyer has stopped typing for a moment.
   *
   * Debounced, not per keystroke: "Toothpaste Niacinamide" is 22 characters,
   * and 22 catalogue searches for a name that is not finished yet would be
   * 21 wasted answers, each briefly linking the line to whatever "Toot"
   * resembles. 600ms is long enough to finish a word and short enough that
   * the row visibly wakes up as soon as the buyer pauses.
   *
   * `recheckDue` is what lets a row say "Checking..." instead of going dark
   * while the timer runs; the transition's `pending` takes over from there.
   */
  const recheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [recheckDue, setRecheckDue] = useState(false)
  const scheduleRecheck = () => {
    setAcknowledgement(null)
    setActualPurchase(false)
    analysisVersion.current++
    if (recheckTimer.current) clearTimeout(recheckTimer.current)
    setRecheckDue(true)
    recheckTimer.current = setTimeout(() => {
      recheckTimer.current = null
      setRecheckDue(false)
      // Reads today's lines through payloadRef, so the text is what is on
      // screen now, not what it was when the timer was set.
      runAnalysisRef.current()
    }, 600)
  }
  useEffect(
    () => () => {
      if (recheckTimer.current) clearTimeout(recheckTimer.current)
    },
    [],
  )

  /**
   * Takes an imported document and fills the form with it.
   *
   * Lines arrive unlinked and are then linked AUTOMATICALLY by the analysis
   * that runs immediately after (see the auto-link block in `runAnalysis`).
   * They are not linked here because the decision needs the catalogue, which
   * only the server can see.
   *
   * Automation is not the same as guessing: a line is only linked where the
   * evidence is decisive, and the decoy case that made "exact" untrustworthy
   * ("Automatic Sweeping Robot", 0 imports, vs the real "Sweeping Robot") is
   * held back for a person on purpose - proven in scripts/verify-autolink.mts.
   *
   * The supplier is still NOT auto-selected. A name read off a photo is a
   * suggestion; picking the wrong supplier silently changes whether VAT is
   * reclaimable, which changes every figure on the screen. Linking a product
   * wrongly is visible and reversible on this screen; the VAT consequence of
   * the wrong supplier is neither.
   */
  const applyImport = (doc: ImportedDoc) => {
    const next = doc.lines.map((l): DraftLine => ({
      key: l.key,
      supplierLabel: l.supplierLabel,
      supplierCode: l.supplierCode ?? '', unit: l.unit ?? '', evidence: l.evidence,
      lineTotal: l.lineTotal == null ? '' : String(l.lineTotal),
      qty: l.qty == null ? '' : String(l.qty),
      unitPriceGross: l.unitPriceGross == null ? '' : String(l.unitPriceGross),
      productId: null, matchMethod: null, productName: null,
    }))
    setLines(next)

    /*
     * Point the ref at the new lines NOW, before React flushes.
     *
     * SECOND BUG behind "still not automated": the auto-link block guards each
     * result with `linesRef.current.find(l => l.key === r.key)` and skips the
     * line when it finds nothing. Called straight after an import, that ref
     * still held the PREVIOUS lines, whose keys are all different - so every
     * single result was skipped and nothing linked, even once the analysis ran.
     */
    linesRef.current = next

    // Clear any earlier analysis - it belongs to lines that no longer exist.
    setAnalysis({})
    setError(null)
    setSaved(null)

    setDocRef(doc.docRef ?? '')
    setPurchaseDate(doc.docDate ?? '')
    setDiscountPercent(doc.discountPercent == null ? '' : String(doc.discountPercent))
    setVatPercent(doc.evidence.vatPercent == null ? '' : String(doc.evidence.vatPercent))
    setVatBasis(null)
    setDiscountTreatment(null)
    setSupplierId('')
    setEvidence(doc.evidence)
    setImported(doc)
    setActualPurchase(false)
    setAcknowledgement(null)
    setIdempotencyKey(crypto.randomUUID())

    /*
     * RUN THE CHECK NOW. This is what "automate this automatically" asked for.
     *
     * THE BUG THE OWNER REPORTED TWICE: linking was automatic only *within* the
     * check, and the check still waited for "Check against imports". So after
     * reading 10 lines the screen sat there with 10 unlinked rows - from the
     * buyer's seat, nothing had been automated at all. Same lesson as the reel
     * differentiation sliders: A STEP THAT WAITS FOR A CLICK DOES NOT HAPPEN.
     *
     * Passed explicitly rather than read from state, because `setLines` above
     * has not flushed yet. The terms-changed effect cannot cover this either:
     * it deliberately returns while nothing has been analysed.
     */
    /*
     * WORK OUT WHETHER THE DOCUMENT'S PRICES INCLUDE VAT, from the document.
     *
     * THE BUG: the app assumed prices always EXCLUDE VAT, so a VAT-inclusive
     * invoice totalling Rs 69,958 had 15% added on top and showed Rs 80,451.70
     * payable - Rs 10,493.70 of cost that does not exist, and a China comparison
     * that made local look 15% dearer than it is.
     *
     * Decided by arithmetic against the printed grand total, never by trusting a
     * label, and it reports `uncertain` instead of guessing.
     */
    const context: ReviewContext = { document: draftEvidence(draftInputs(next), doc.evidence), overrides: { pricesIncludeVat: null, discountTreatment: null }, supplierId: '' }
    reviewContextRef.current = context
    termsRevisionRef.current = evidenceRevision(context)
    runAnalysisRef.current(draftInputs(next), context)
  }

  /**
   * Does the supplier read off the document match the one selected?
   *
   * Compared loosely (case and punctuation ignored) because "MORIS TRADING LTD"
   * and "Moris Trading Ltd." are the same firm. A VAT number match is stronger
   * evidence than a name, so it wins outright.
   */
  const supplierMismatch = (() => {
    if (!imported || !supplier) return false
    if (imported.vatNumber && supplier.vatNumber && vatKey(imported.vatNumber) && vatKey(supplier.vatNumber)) {
      return vatKey(imported.vatNumber) !== vatKey(supplier.vatNumber)
    }
    if (!imported.supplierName) return false
    const a = cleanKey(imported.supplierName)
    const b = cleanKey(supplier.name)
    return !(a.includes(b) || b.includes(a))
  })()

  /**
   * Which supplier on our list is the one printed on the document, if any.
   *
   * The owner's screenshot: the banner read "looks like it is from BERNARD AND
   * FENLAN CO. LTD. (28461839)" and, one row down, "New supplier" opened a form
   * with EMPTY fields and placeholder text - the document's own answer was on
   * screen and the buyer was asked to retype it. "Should get option to add this
   * as new supplier right." Right.
   *
   * This resolves the printed name/number against the list with the SAME
   * loose comparison `supplierMismatch` uses (VAT number wins, then name
   * containment), so the two can never disagree about who the document is
   * from. The result drives ONE offer in the banner: "Use <existing>" when
   * we already know them, "Add <printed name> as a new supplier" when we do
   * not. Either is still a CLICK - the supplier decides VAT reclaimability, so
   * it is never selected silently - but the click is now on the answer rather
   * than on a blank form.
   */
  const docSupplier = (() => {
    if (!imported || !imported.supplierName) return null
    const vat = imported.vatNumber ? vatKey(imported.vatNumber) : ''
    const name = cleanKey(imported.supplierName)
    const byVat = vat ? supplierList.find((s) => s.vatNumber && vatKey(s.vatNumber) === vat) : undefined
    const byName =
      byVat ??
      supplierList.find((s) => {
        const b = cleanKey(s.name)
        return b.length >= 4 && (name.includes(b) || b.includes(name))
      })
    return { known: byName ?? null, name: imported.supplierName, vatNumber: imported.vatNumber }
  })()

  /** Opens the new-supplier form already filled with what the document says. */
  const addSupplierFromDocument = () => {
    if (!docSupplier) return
    setNewSupplier({ name: docSupplier.name, vatNumber: docSupplier.vatNumber ?? '', phone: '' })
    setShowNewSupplier(true)
  }

  const payload = (): DraftLineInput[] => draftInputs(linesRef.current)

  /*
   * Held in a ref so `runAnalysis` can stay a stable callback while still reading
   * TODAY's lines. Without this the effect below would either capture an old
   * `lines` array or have to list it as a dependency, which would re-check the
   * whole quotation on every keystroke.
   */
  const payloadRef = useRef(payload)
  payloadRef.current = payload

  /**
   * Today's lines, readable from inside the analysis callback.
   *
   * The auto-link step must check whether a line is ALREADY linked or has been
   * cleared, and the `lines` captured in the callback's closure can be a render
   * behind - which would re-link a product the buyer just removed.
   */
  const linesRef = useRef(lines)
  linesRef.current = lines

  /**
   * Whether the typed prices already contain VAT, and how that was decided.
   *
   * Kept beside the reason on purpose: a money basis that changes every figure
   * on the screen must never be a silent setting. `uncertain` means the document
   * could not settle it, and the buyer is told so rather than shown a confident
   * total built on a guess.
   */
  const [vatBasis, setVatBasis] = useState<VatBasis | null>(null)
  const overrides = useMemo<ReceiptOverrides>(() => ({ pricesIncludeVat: vatBasis?.pricesIncludeVat ?? null, discountTreatment }), [vatBasis, discountTreatment])
  const receiptDocument = useMemo(() => draftEvidence(draftInputs(lines), {
    ...(evidence ?? normaliseEvidence({ lines: [], pricesIncludeVat: vatBasis?.pricesIncludeVat ?? false, discountIncluded: false })),
    docRef: docRef || null, docDate: purchaseDate || null,
    discountPercent: nullableNumber(discountPercent), vatPercent: nullableNumber(vatPercent),
  }), [lines, evidence, docRef, purchaseDate, discountPercent, vatPercent, vatBasis])
  const receipt = useMemo(() => reconcileReceipt(receiptDocument, overrides, vatReclaimable), [receiptDocument, overrides, vatReclaimable])
  const pricesIncludeVat = receipt.resolved?.pricesIncludeVat ?? false
  const reviewContext: ReviewContext = { document: receiptDocument, overrides, supplierId }
  const reviewContextRef = useRef(reviewContext)
  reviewContextRef.current = reviewContext
  const termsRevision = evidenceRevision(reviewContext)
  const termsRevisionRef = useRef(termsRevision)
  termsRevisionRef.current = termsRevision
  const analysis = useMemo(() => {
    const current: Record<string, AnalysedLine> = {}
    for (const line of lines) {
      const answer = analysisAnswers[line.key]
      if (answer?.termsRevision === termsRevision && answer.lineRevision === lineAnalysisRevision(line)) {
        current[line.key] = answer.value
      }
    }
    return current
  }, [analysisAnswers, lines, termsRevision])

  const unitAmountsFor = (key: string) => {
    const line = lines.find((item) => item.key === key)
    return line && Number(line.qty) > 0 ? analysis[key]?.unitAmounts ?? null : null
  }

  /**
   * The ONE place the server analysis is requested.
   *
   * Every number on this screen - net, VAT, reclaimable, and the whole China
   * comparison - comes from this call, so a single runner keeps them consistent
   * by construction. `overrideLines` exists only so a just-confirmed link can be
   * sent without waiting for React to flush the state update.
   */
  const runAnalysis = useCallback(
    (overrideLines?: DraftLineInput[], overrideContext?: ReviewContext) => {
      const version = ++analysisVersion.current
      if (recheckTimer.current) clearTimeout(recheckTimer.current)
      recheckTimer.current = null
      setRecheckDue(false)
      const body = overrideLines ?? payloadRef.current()
      // Nothing described yet: there is nothing to check, and asking would
      // replace real answers with empty ones.
      if (!body.some((l) => l.supplierLabel.trim())) return
      const context = overrideContext ?? reviewContextRef.current
      const requestDocument = draftEvidence(body, context.document)
      const requestTerms = evidenceRevision({ ...context, document: requestDocument })
      const inputByKey = new Map(body.map((line) => [line.key, lineAnalysisRevision(line)]))
      setError(null)
      startTransition(async () => {
        try {
          const result = await analyseLinesAction({
            lines: body, document: requestDocument, overrides: context.overrides, supplierId: context.supplierId || null,
          })
          if (version !== analysisVersion.current || requestTerms !== termsRevisionRef.current) return
          setAnalysis(Object.fromEntries(result.map((r) => [r.key, {
            value: r, lineRevision: inputByKey.get(r.key) ?? '', termsRevision: requestTerms,
          }])))

          /*
           * AUTOMATIC LINKING happens here, the moment the answers arrive.
           *
           * Nothing to click. A line is linked when the server's verdict says
           * the evidence is decisive (see lib/local-purchasing/autolink.ts);
           * lines where it is not stay unlinked and ask, which is a handful of
           * rows instead of every row.
           *
           * Two lines are never touched: one that already carries a product
           * (a human answer, or an earlier auto-link), and one a human has
           * explicitly cleared.
           */
          const auto = new Map<string, Partial<DraftLine>>()
          for (const r of result) {
            const current = linesRef.current.find((l) => l.key === r.key)
            if (!current || lineAnalysisRevision(current) !== inputByKey.get(r.key)) continue
            const patch: Partial<DraftLine> = {}
            if (!current.productId && !current.linkCleared && r.autoLink.link) {
              Object.assign(patch, { productId: r.autoLink.productId, productName: r.autoLink.productName, matchMethod: 'auto' })
            }
            const productId = patch.productId ?? current.productId
            if (!current.variantId && !current.variantCleared && r.supplierVariant?.productId === productId) {
              Object.assign(patch, { variantId: r.supplierVariant.variantId, variantSource: 'supplier', variantCleared: false })
            }
            if (Object.keys(patch).length) auto.set(r.key, patch)
          }

          if (auto.size) {
            setAcknowledgement(null)
            setActualPurchase(false)
            const linkedLines = linesRef.current.map((l) => ({ ...l, ...auto.get(l.key) }))
            linesRef.current = linkedLines
            setLines(linkedLines)
            /*
             * Re-check with the new links so the China comparison exists for
             * them - an unlinked line has no comparison to show.
             *
             * This terminates: the re-run only auto-applies to lines with NO
             * product, and every line in `auto` now has one.
             */
            runAnalysisRef.current(draftInputs(linkedLines), context)
          }
        } catch (e) {
          if (version === analysisVersion.current && requestTerms === termsRevisionRef.current) {
            setError(e instanceof Error ? e.message : 'Could not check the lines')
          }
        }
      })
    },
    // pricesIncludeVat belongs here for the same reason as vatReclaimable: it
    // feeds every derived figure, so leaving it out would leave the totals
    // describing the old basis after the buyer switches it.
    [],
  )

  /**
   * Lets the analysis re-invoke itself after applying auto-links, without
   * making `runAnalysis` depend on its own identity (which no `useCallback`
   * can express).
   */
  const runAnalysisRef = useRef(runAnalysis)
  runAnalysisRef.current = runAnalysis

  const analyse = () => runAnalysis()

  /*
   * RE-RUN WHEN THE TERMS CHANGE, NOT JUST WHEN THE BUTTON IS PRESSED.
   *
   * MEASURED BUG this fixes: checking the lines first and choosing the supplier
   * second left "Input VAT reclaimable Rs 0.00" and "True cost after reclaim
   * Rs 1,932.00" on screen while the banner directly above already said "VAT
   * registered ... input VAT is reclaimable". The header re-rendered from
   * `supplier`; the totals came from a server answer computed when there was no
   * supplier, and nothing invalidated it. Same for editing the discount or VAT
   * rate after checking.
   *
   * `tsc` was clean and every script assertion passed - only looking at the
   * screen caught it. Any input that feeds the money must invalidate the money.
   */
  const analysedCount = Object.keys(analysis).length
  const changeTerms = (update: () => void) => {
    update()
    setAnalysis({})
    scheduleRecheck()
  }
  const selectSupplier = (id: string) => {
    const next = linesRef.current.map((line) => {
      if (line.variantSource === 'manual') return line
      if (line.matchMethod === 'auto' || line.matchMethod === 'alias') return { ...line, ...clearedVariant, productId: null, productName: null, matchMethod: null, linkCleared: false }
      return line.variantSource === 'supplier' ? { ...line, ...clearedVariant } : line
    })
    linesRef.current = next
    setLines(next)
    changeTerms(() => setSupplierId(id))
  }
    /*
     * `pricesIncludeVat` BELONGS HERE, and leaving it out reproduced this exact
     * bug a fourth time: clicking "Include VAT" changed the explanation under
     * the totals while "Goods, excluding VAT Rs 5,584.00" and the VAT added on
     * top stayed exactly as they were. The words said one thing and the money
     * said another - the worst of the two possible failures, because it looks
     * like it worked.
     *
     * I had added the basis to `runAnalysis`'s own deps and thought that was
     * enough. It was not: that only rebuilds the callback, it does not re-invoke
     * it. Only the browser caught this; tsc was clean.
     */
  // Terms now invalidate synchronously in their handlers, before a debounced request.
  // A response must also match the current line and terms revisions to be displayed.

  /**
   * A person picks a product. Re-runs the check, because the comparison now
   * exists, and TEACHES the catalogue this supplier's wording.
   *
   * `method` distinguishes accepting the machine's first choice ('confirmed')
   * from overriding it ('manual') - the second is the more interesting event,
   * because a pattern of overrides is the signal that the ranking is wrong.
   */
  const confirmProduct = (
    key: string,
    productId: string,
    productName: string,
    method: LineMatchMethod = 'confirmed',
  ) => {
    /*
     * ONE DECISION PER DESCRIPTION, NOT PER ROW.
     *
     * This is the single thing that made the owner's 179-row PO import feel
     * fine ("690 normally was okay, don't know how"): it asks once per distinct
     * product name and applies the answer to every row carrying it. Measured on
     * that data, 179 rows needed 173 answers, 152 needed 138. Until now this
     * screen linked only the row whose button was pressed, so a description on
     * four rows meant the same question four times - on a 470-line sheet that
     * is the difference between an afternoon and ten minutes.
     *
     * A row the buyer had cleared is included on purpose: confirming "this
     * description IS product X" is a statement about the wording, and it
     * supersedes an earlier "not that one" on a sibling row.
     */
    setAcknowledgement(null)
    setActualPurchase(false)
    const keys = new Set(sameDescriptionKeys(linesRef.current, key))

    const nextLines = linesRef.current.map((l) =>
      keys.has(l.key) ? { ...l, ...(l.productId !== productId ? clearedVariant : {}), productId, productName, matchMethod: method, linkCleared: false } : l,
    )
    linesRef.current = nextLines
    setLines(nextLines)
    runAnalysis(
      payloadRef.current().map((l) => (keys.has(l.key) ? { ...l, productId, matchMethod: method } : l)),
    )

    // Decisions are staged here. The purchase transaction learns them only for
    // the chosen supplier, with machine/human provenance intact.
  }

  /**
   * A person removes a link. `linkCleared` makes it STICK - see DraftLine.
   *
   * FIFTH stale-derived-money bug in this module, caught by the screenshot of
   * the product picker: this used to change the line and nothing else, so the
   * row said "Link removed" while "158.3% dearer than importing" and "Stock
   * already covered this" - both facts about the product just removed - stayed
   * beside it, and the totals still counted the line as linked. Re-running the
   * analysis without the product is what makes the money follow the words; the
   * server answers "unlinked" for that line and the totals recount. Both
   * auto-link guards honour `linkCleared`, so the re-run cannot put the same
   * product straight back.
   *
   * Group-wide for the same reason confirming is: "this wording is NOT that
   * product" is a statement about the wording. Clearing one of three
   * "Sweeping Robot" rows and leaving two on the wrong product is the worse
   * outcome, and the "3 rows" badge already tells the buyer that one click
   * acts on all of them.
   */
  const clearLink = (key: string) => {
    setAcknowledgement(null)
    setActualPurchase(false)
    const keys = new Set(sameDescriptionKeys(linesRef.current, key))
    const nextLines = linesRef.current.map((l) =>
      keys.has(l.key) ? { ...l, ...clearedVariant, productId: null, productName: null, matchMethod: null, linkCleared: true } : l,
    )
    linesRef.current = nextLines
    setLines(nextLines)
    runAnalysis(
      payloadRef.current().map((l) => (keys.has(l.key) ? { ...l, productId: null, matchMethod: null } : l)),
    )
  }

  /**
   * Opens the create dialog for a line nothing matches.
   *
   * This used to insert straight away under the supplier's wording, with no
   * photo. That is the exact mechanism that minted the catalogue's duplicate
   * rows, so the dialog now takes a picture, lets the picture propose the name,
   * and shows any catalogue product the picture resembles before anything is
   * written. The server still refuses a normalised-name twin either way.
   */
  const createProduct = (key: string) => {
    const line = linesRef.current.find((l) => l.key === key)
    if (!line?.supplierLabel.trim()) return
    setError(null)
    /*
     * Seed the new product's cost from the SERVER's net unit price for this
     * line, never a second calculation here. The discount maths lives in one
     * place (`netUnitPrice`, via the analysis) and a duplicate of it on the
     * client would be free to disagree with the screen.
     *
     * Falls back to nothing rather than to the gross price: a cost_price that
     * quietly ignores the discount is worse than no cost_price.
     */
    setCreating({
      lineKey: key,
      supplierLabel: line.supplierLabel.trim(),
      supplierCode: line.supplierCode || null,
    })
  }

  /**
   * The dialog's answer. All three outcomes end in `confirmProduct`, so the
   * line, its sibling rows, the analysis and the learned alias all follow -
   * the dialog decides WHICH product, this decides what a decision means.
   */
  const onCreateDone = (key: string, outcome: CreateProductOutcome) => {
    if (outcome.kind !== 'linked') rememberProduct(outcome.product)
    if (outcome.kind === 'created') {
      confirmProduct(key, outcome.productId, outcome.name, 'created')
      setNotice(`Created "${outcome.name}" with selling prices${outcome.product.variants?.length ? ' and variants' : ''} in Inventory and linked the matching lines.${outcome.product.variants?.length ? ' Choose the purchased variant on each row.' : ''} The purchase receipt is not saved yet.`)
    } else if (outcome.kind === 'reused') {
      confirmProduct(key, outcome.productId, outcome.name, 'manual')
      setNotice(outcome.reason)
    } else {
      // The photo recognised an existing product: same standing as picking it
      // from the catalogue by hand, and the alias is learned the same way.
      confirmProduct(key, outcome.productId, outcome.name, 'manual')
      setNotice(`Linked to the existing "${outcome.name}" - the photo matched it`)
    }
  }

  const addSupplier = () => {
    setError(null)
    startTransition(async () => {
      try {
        const created = await createSupplierAction({
          name: newSupplier.name,
          vatNumber: newSupplier.vatNumber || null,
          phone: newSupplier.phone || null,
        })
        if (created.reused) {
          // Same VAT number, existing row: select it, and say so - a buyer who
          // typed "Bernard Trading" and sees "BERNARD AND FENLAN CO. LTD."
          // selected needs to know why, or it looks like the wrong supplier.
          setNotice(created.reused)
        } else {
          const option: SupplierOption = {
            id: created.id,
            name: created.name,
            vatNumber: created.vatNumber,
            phone: newSupplier.phone || null,
            paymentTermsDays: null,
          }
          setSupplierList((prev) => [...prev, option].sort((a, b) => a.name.localeCompare(b.name)))
        }
        selectSupplier(created.id)
        setShowNewSupplier(false)
        setNewSupplier({ name: '', vatNumber: '', phone: '' })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not add the supplier')
      }
    })
  }

  const save = () => {
    setError(null)
    setSaved(null)
    startTransition(async () => {
      try {
        const result = await savePurchaseAction({
          supplierId,
          docRef,
          purchaseDate: purchaseDate || null,
          discountPercent: Number(discountPercent) || 0,
          vatPercent: Number(vatPercent) || 0,
          // Whether VAT is actually reclaimable is stored WITH the purchase, not
          // re-derived later from the supplier: the supplier's registration can
          // change, but what this receipt entitled us to reclaim cannot.
          vatReclaimable,
          // The server converts inclusive prices to VAT-exclusive before storing
          // them, so this has to travel with the save or the stored cost is 15%
          // too high for the life of the record.
          pricesIncludeVat,
          documentTotalGross: receiptDocument.declaredTotal,
          documentIds: imported?.documentId ? [imported.documentId] : [],
          documentRevision: imported?.documentRevision, reviewRevision: imported?.reviewRevision,
          document: receiptDocument, overrides, idempotencyKey, actualPurchase,
          acknowledgement: currentReason.trim().length >= 8 ? { revision: reviewRevision, reason: currentReason } : null,
          lines: payload().map((l) => {
            // Carry the China figure the buyer actually SAW into the record, so
            // a later import price change cannot rewrite the history of this
            // decision.
            const a = analysis[l.key]
            return {
              ...l,
              chinaCpAtPurchase: a?.comparison.chinaUnitCost ?? null,
              variancePercent: a?.comparison.variancePercent ?? null,
            }
          }),
        })
        setSaved({ id: result.id, message: `Saved ${result.lineCount} line${result.lineCount === 1 ? '' : 's'}. Linked supplier products are now available for reorders. No stock or payment was posted.` })
        analysisVersion.current++
        const cleared = [blankLine()]
        linesRef.current = cleared
        setLines(cleared)
        setAnalysis({})
        setImported(null)
        setEvidence(null)
        setDocRef('')
        setPurchaseDate('')
        setDiscountPercent('')
        setVatPercent('15')
        setVatBasis(null)
        setDiscountTreatment(null)
        setActualPurchase(false)
        setAcknowledgement(null)
        setIdempotencyKey(crypto.randomUUID())
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save')
      }
    })
  }

  /*
   * Totals, recomputed from the SERVER's per-line answers.
   *
   * Deliberately not recalculated from the raw inputs in the browser: that would
   * be a second derivation of the same money, and the two would eventually
   * disagree. Lines not yet analysed simply do not contribute, which is why the
   * footer says how many are still unchecked.
   */
/**
 * How much of the linking the system did, and how much is left for a person.
 *
 * Counts only lines that carry a label, so the blank spare row at the bottom of
 * the table cannot inflate "needs your decision".
 */
  /*
   * Repeated descriptions in the current document. Derived from `lines` on
   * every change so it can never describe a file the buyer has since edited -
   * the fourth stale-derived-value bug in this module was enough.
   */
  const repeats = useMemo(() => summariseRepeats(lines), [lines])
  const groupSizeByKey = useMemo(() => {
    const m = new Map<string, { size: number; identical: number }>()
    for (const g of repeats.groups) for (const k of g.keys) m.set(k, { size: g.keys.length, identical: g.identicalRows })
    return m
  }, [repeats])

  /*
   * Has this supplier + reference already been saved? Asked as soon as both are
   * known, so the buyer finds out BEFORE linking 470 lines, not at Save. The
   * server enforces the same rule regardless - this is the courtesy copy.
   */
  const { data: alreadySaved } = useSWR(
    supplierId && docRef.trim() ? ['existing-purchase', supplierId, docRef.trim()] : null,
    ([, sid, ref]) => findExistingPurchaseAction({ supplierId: sid, docRef: ref }),
    { revalidateOnFocus: false },
  )

  const linkStats = useMemo(() => {
    const real = lines.filter((l) => l.supplierLabel.trim())
    const linked = real.filter((l) => l.productId).length
    return { total: real.length, linked, pending: real.length - linked }
}, [lines])

const totals = useMemo(() => {
  let net = 0
    let vat = 0
    let reclaimable = 0
    let dearerCount = 0
    let dearerExtra = 0
    let cheaperSaving = 0
    let stockCovered = 0
    let unlinked = 0
    let analysed = 0

    for (const line of lines) {
      const a = analysis[line.key]
      if (!a) continue
      analysed += 1
      net += a.vat.net
      vat += a.vat.vat
      reclaimable += a.vat.reclaimable
      if (a.comparison.verdict === 'unlinked') unlinked += 1
      if (a.comparison.verdict === 'local_dearer' && a.comparison.totalDifference != null) {
        dearerCount += 1
        dearerExtra += a.comparison.totalDifference
      }
      if (a.comparison.verdict === 'local_cheaper' && a.comparison.totalDifference != null) {
        cheaperSaving += Math.abs(a.comparison.totalDifference)
      }
      if (a.comparison.stockCoversQty) stockCovered += 1
    }

    return {
      net: receipt.totals?.net ?? 0,
      vat: receipt.totals?.vat ?? 0,
      gross: receipt.totals?.payable ?? 0,
      reclaimable: receipt.totals?.reclaimable ?? 0,
      effective: receipt.totals?.effectiveCost ?? 0,
      dearerCount,
      dearerExtra: round2(dearerExtra),
      cheaperSaving: round2(cheaperSaving),
      stockCovered,
      unlinked,
      analysed,
      pendingCheck: lines.filter((l) => l.supplierLabel.trim()).length - analysed,
    }
  }, [lines, analysis, receipt])

  // `!alreadySaved` mirrors the server's rule; the server still checks, because
  // a disabled button is a courtesy and not a guarantee.
  const reviewRevision = purchaseReviewRevision(receipt.inputRevision, {
    supplierId, docRef, purchaseDate: purchaseDate || null, lines: payload(), actualPurchase,
    documentIds: imported?.documentId ? [imported.documentId] : [], documentRevision: imported?.documentRevision,
    reviewRevision: imported?.reviewRevision,
  })
  const sourceEdited = Boolean(imported && evidenceRevision(comparableEvidence(imported.evidence)) !== evidenceRevision(comparableEvidence(receiptDocument)))
  const requiresReason = receipt.status !== 'verified' || sourceEdited || supplierMismatch ||
    Boolean(imported && !imported.supplierName) || !['invoice','receipt'].includes(receiptDocument.docKind) ||
    Object.values(overrides).some((value) => value != null) || Object.values(analysis).some((line) => line.supplierConflict)
  const currentReason = acknowledgement?.revision === reviewRevision ? acknowledgement.reason : ''
const hasInvalidVariant = lines.some((line) => Boolean(variantSelectionError(line.productId ? productsById.get(line.productId) : undefined, line.variantId)))
const canSave = Boolean(supplierId) && receipt.canRecord && actualPurchase && !alreadySaved && !importBusy && !hasInvalidVariant &&
  !recheckDue && totals.pendingCheck === 0 && (!requiresReason || currentReason.trim().length >= 8)

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Local purchase</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Record what was bought from a local supplier. Import the receipt or invoice to fill the
          lines in one go. Each line is checked against what the same product costs to import from
          China and what is already in stock. Nothing is blocked - the numbers are shown so the
          decision is made with them in view.
        </p>
      </header>

      {/* ---------------------------------------------------------------- */}
      {/* Import the document                                              */}
      {/* ---------------------------------------------------------------- */}
      <nav aria-label="Local purchasing" className="flex flex-wrap gap-2">
        <Button asChild variant="outline"><Link href="/dashboard/purchasing/local/orders">Supplier reorders</Link></Button>
        <Button asChild variant="outline"><Link href="/dashboard/purchasing/local/history">Saved purchases</Link></Button>
      </nav>
      <DocumentImport onImported={applyImport} disabled={pending} onBusyChange={setImportBusy} />
      {(imported || lines.some((line) => line.supplierLabel.trim())) && <ReceiptCheckSummary check={receipt} />}

      {imported ? (
        <section
          className={cn(
            'rounded-lg border p-4',
            receipt.status !== 'verified'
              ? 'border-amber-500/40 bg-amber-500/5'
              : 'border-border bg-card/40',
          )}
        >
          <div className="flex items-start gap-2">
            {receipt.status !== 'verified' ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
            ) : (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
            )}
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-foreground">
                {imported.lines.length} line{imported.lines.length === 1 ? '' : 's'} read from the{' '}
                {imported.source === 'sheet' ? 'spreadsheet' : 'document'}
                {imported.declaredTotal != null
                  ? `. The document says its total is ${rs(imported.declaredTotal)}.`
                  : '.'}
              </p>

              {/*
                * The supplier is NOT auto-selected from the document, so say who
                * it looked like and let the owner choose. Selecting it silently
                * would decide whether VAT is reclaimable, which moves every
                * figure on the screen.
                */}
              {docSupplier && !supplierId ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs leading-relaxed text-muted-foreground">
                  <span>
                    The document looks like it is from{' '}
                    <span className="text-foreground">{docSupplier.name}</span>
                    {docSupplier.vatNumber ? ` (${docSupplier.vatNumber})` : ''}.
                    {docSupplier.known
                      ? ' We already have them.'
                      : ' They are not on the supplier list yet.'}
                  </span>
                  {docSupplier.known ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => selectSupplier(docSupplier.known!.id)}
                      className="h-7 px-2.5 text-xs"
                    >
                      <Check className="mr-1 h-3 w-3" />
                      Use {docSupplier.known.name}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={addSupplierFromDocument}
                      className="h-7 px-2.5 text-xs"
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      Add {docSupplier.name} as a new supplier
                    </Button>
                  )}
                  <span className="text-muted-foreground/70">It decides whether the VAT can be reclaimed.</span>
                </div>
              ) : null}

              {supplierMismatch ? (
                <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-300">
                  The document says{' '}
                  <span className="font-medium">{imported.supplierName ?? 'another supplier'}</span>
                  {imported.vatNumber ? ` (${imported.vatNumber})` : ''}, but{' '}
                  <span className="font-medium">{supplier?.name}</span> is selected. Check this is
                  the right supplier - it decides whether the VAT can be reclaimed.
                </p>
              ) : null}

              {imported.warnings.length ? (
                <ul className="flex flex-col gap-1">
                  {imported.warnings.map((w, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"
                    >
                      <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {/*
                * Replaces "products are left unlinked on purpose", which this
                * feature made untrue. States what actually happened, and how
                * many rows still want a person - so the buyer knows the size of
                * the job left rather than scrolling to find out.
                */}
              {/*
                * The in-flight case is NOT cosmetic. Matching 10 lines takes a
                * few seconds, and without this the banner spends that time
                * saying "10 need your decision" - which is exactly the "nothing
                * was automated" impression this change is meant to remove.
                */}
              <p className="flex items-center gap-2 text-xs leading-relaxed text-muted-foreground">
                {pending && analysedCount === 0 ? (
                  <>
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                    Matching {linkStats.total} lines against your catalogue...
                  </>
                ) : linkStats.pending === 0 ? (
                  `All ${linkStats.total} lines are linked to products - review and save.`
                ) : (
                  `${linkStats.linked} of ${linkStats.total} lines linked automatically. ${linkStats.pending} need${linkStats.pending === 1 ? 's' : ''} your decision below.`
                )}
              </p>

              {/*
                * REPEATS, stated up front.
                *
                * On the owner's PO imports a description repeating is normal
                * (14 names on 28 rows in one 152-row file) and all rows were
                * kept. The count that matters at 470 lines is DECISIONS, so
                * say it: one answer per description, applied to every row.
                * An identical row (same qty AND price twice) is different -
                * still kept, because the printed total includes it and the
                * VAT-basis check reconciles against that total, but named so
                * the buyer looks at the paper.
                */}
              {repeats.repeatedDescriptions > 0 && (
                <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                  <Copy className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    {repeats.repeatedDescriptions} description{repeats.repeatedDescriptions === 1 ? '' : 's'} appear
                    {repeats.repeatedDescriptions === 1 ? 's' : ''} on more than one row ({repeats.rowsInRepeats} rows).
                    Rows are kept; one decision per description covers all of them, so {linkStats.total} rows are at most{' '}
                    {repeats.decisions} decisions.
                    {repeats.identicalRows > 0 && (
                      <>
                        {' '}
                        <span className="text-amber-400">
                          {repeats.identicalRows} row{repeats.identicalRows === 1 ? ' is' : 's are'} an exact repeat of another
                          (same quantity and price) - check the document.
                        </span>
                      </>
                    )}
                  </span>
                </p>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {/*
        * SAME INVOICE ALREADY SAVED - shown the moment supplier + reference are
        * both known, so nobody links 470 lines first. Saving is blocked on the
        * server too; this is the early copy of that rule, not the only one.
        */}
      {alreadySaved && (
        <section className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">
              Reference {alreadySaved.docRef} from this supplier is already saved
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Saved on {alreadySaved.purchaseDate} with {alreadySaved.lineCount} line
              {alreadySaved.lineCount === 1 ? '' : 's'} totalling {rs(alreadySaved.total)} excluding VAT. Saving this
              again would count that money twice in price history and cost comparisons. If the supplier really issued a
              second document under the same number, change the reference (for example add &quot;-2&quot;).
            </p>
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Supplier + document header                                       */}
      {/* ---------------------------------------------------------------- */}
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex min-w-56 flex-col gap-1.5">
            <Label htmlFor="supplier" className="text-xs uppercase tracking-wider text-muted-foreground">
              Supplier
            </Label>
            <select
              id="supplier"
              value={supplierId}
              onChange={(e) => selectSupplier(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Choose a supplier...</option>
              {supplierList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.vatNumber ? '' : '  (no VAT number)'}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ref" className="text-xs uppercase tracking-wider text-muted-foreground">
              Their reference
            </Label>
            <Input
              id="ref"
              value={docRef}
              onChange={(e) => changeTerms(() => setDocRef(e.target.value))}
              placeholder="INV 144"
              className="h-9 w-40"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qdate" className="text-xs uppercase tracking-wider text-muted-foreground">
              Date
            </Label>
            <Input
              id="qdate"
              type="date"
              value={purchaseDate}
              onChange={(e) => changeTerms(() => setPurchaseDate(e.target.value))}
              className="h-9 w-40"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="disc" className="text-xs uppercase tracking-wider text-muted-foreground">
              Printed discount %
            </Label>
            <Input
              id="disc"
              type="number"
              inputMode="decimal"
              value={discountPercent}
              onChange={(e) => changeTerms(() => setDiscountPercent(e.target.value))}
              min={0}
              max={100}
              step="0.001"
              // Deliberately "0", not an example like "20": a greyed-out "20"
              // in a money field reads as a 20% discount already applied - I
              // misread my own screenshot that way - and believing in a
              // discount that is not there understates every line's cost.
              placeholder="0"
              className="h-9 w-24 font-mono tabular-nums"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vat" className="text-xs uppercase tracking-wider text-muted-foreground">
              VAT %
            </Label>
            <Input
              id="vat"
              type="number"
              inputMode="decimal"
              value={vatPercent}
              onChange={(e) => changeTerms(() => setVatPercent(e.target.value))}
              min={0}
              max={100}
              step="0.001"
              className="h-9 w-24 font-mono tabular-nums"
            />
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              // Opening the form from here is the second road to the same
              // answer: if the document named a supplier we do not have, start
              // from what it printed, not from an empty box. Never overwrite
              // something the buyer has already typed.
              if (!showNewSupplier && docSupplier && !docSupplier.known && !newSupplier.name.trim()) {
                addSupplierFromDocument()
                return
              }
              setShowNewSupplier((v) => !v)
            }}
            className="h-9"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New supplier
          </Button>
        </div>

        {/*
         * The VAT consequence, said in words at the moment it applies. A buyer
         * comparing prices cannot be expected to remember that an unregistered
         * supplier's quote is 15% worse than it looks.
         */}
        {supplier && (
          <p
            className={cn(
              'mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed',
              vatReclaimable
                ? 'border-border bg-muted/30 text-muted-foreground'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-300',
            )}
          >
            {vatReclaimable ? (
              <>
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  VAT registered ({supplier.vatNumber}). Input VAT is reclaimable, so prices are
                  compared excluding VAT - the VAT you pay comes back and is not a cost.
                </span>
              </>
            ) : (
              <>
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  No VAT number on file, so nothing is reclaimable and the full price is a real
                  cost. Comparisons below include VAT for this supplier.
                </span>
              </>
            )}
          </p>
        )}

        {showNewSupplier && (
          <div className="mt-4 flex flex-wrap items-end gap-3 rounded-md border border-border bg-muted/20 p-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input
                value={newSupplier.name}
                onChange={(e) => setNewSupplier((s) => ({ ...s, name: e.target.value }))}
                placeholder="Made By Moris Ltd"
                className="h-9 w-56"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">VAT number</Label>
              <Input
                value={newSupplier.vatNumber}
                onChange={(e) => setNewSupplier((s) => ({ ...s, vatNumber: e.target.value }))}
                placeholder="VAT20123456"
                className="h-9 w-40 font-mono"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Phone</Label>
              <Input
                value={newSupplier.phone}
                onChange={(e) => setNewSupplier((s) => ({ ...s, phone: e.target.value }))}
                className="h-9 w-36"
              />
            </div>
            <Button type="button" size="sm" onClick={addSupplier} disabled={pending || !newSupplier.name.trim()} className="h-9">
              Add
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowNewSupplier(false)} className="h-9">
              Cancel
            </Button>
          </div>
        )}
      </section>

      {/*
        * THE PRICE BASIS, stated and changeable right beside the figures
        * it controls.
        *
        * This was a silent assumption that prices exclude VAT, which added
        * 15% to a VAT-inclusive invoice: Rs 69,958 became Rs 80,451.70
        * payable. A setting that moves every number on the screen has to
        * be visible, and has to say how it was decided.
        */}
      <ReceiptEvidenceEditor document={receiptDocument} overrides={overrides}
        onDocument={(patch) => changeTerms(() => {
          setEvidence((current) => ({ ...(current ?? receiptDocument), ...patch }))
          if ('discountPercent' in patch) setDiscountPercent(patch.discountPercent == null ? '' : String(patch.discountPercent))
          if ('vatPercent' in patch) setVatPercent(patch.vatPercent == null ? '' : String(patch.vatPercent))
        })}
        onOverrides={(patch) => changeTerms(() => {
          setVatBasis(patch.pricesIncludeVat == null ? null : { pricesIncludeVat: patch.pricesIncludeVat, uncertain: false, reason: 'Buyer override; reason required when saving.' })
          setDiscountTreatment(patch.discountTreatment ?? null)
        })}
      />

      {/* ---------------------------------------------------------------- */}
      {/* Lines                                                            */}
      {/* ---------------------------------------------------------------- */}
      {catalogueError && (
        <Alert>
          <AlertDescription>
            Could not refresh Inventory prices. Your purchase draft is unchanged; opening the pricing dialog checks current prices again.
          </AlertDescription>
        </Alert>
      )}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Purchased lines
          </h2>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => { const next = [...linesRef.current, blankLine()]; linesRef.current = next; setLines(next); scheduleRecheck() }}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add line
            </Button>
            <Button type="button" size="sm" onClick={analyse} disabled={pending}>
              {pending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search className="mr-1.5 h-3.5 w-3.5" />
              )}
              Check against imports
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {lines.map((line, index) => {
            const a = analysis[line.key]
            const linkedProduct = line.productId ? productsById.get(line.productId) : undefined
            const linkedName = linkedProduct?.name ?? line.productName ?? 'this product'
            const unitAmounts = unitAmountsFor(line.key)
            const verdict = a?.comparison.verdict
            const tone = a?.comparisonScope === 'variant_unavailable'
              ? { ...VERDICT.no_china_history, label: 'No variant-specific import cost' }
              : verdict ? VERDICT[verdict] : null
            const Icon = tone?.icon

            return (
              <article key={line.key} id={`receipt-line-${line.key}`} className="rounded-lg border border-border bg-card text-card-foreground">
                {/* The typed line */}
                <div className="flex flex-wrap items-end gap-3 p-3">
                  <span className="w-6 pb-2 text-center font-mono text-xs text-muted-foreground">
                    {index + 1}
                  </span>
                  <div className="flex min-w-0 flex-1 basis-full flex-col gap-1.5 sm:min-w-64 sm:basis-auto">
                    <Label className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                      Their description
                      {/*
                        * Tells the buyer, on the row itself, that one answer
                        * here links N rows - otherwise the group-wide link looks
                        * like the screen changing lines nobody touched.
                        */}
                      {(groupSizeByKey.get(line.key)?.size ?? 1) > 1 && (
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded px-1.5 py-0.5 normal-case tracking-normal',
                            (groupSizeByKey.get(line.key)?.identical ?? 0) > 0
                              ? 'bg-amber-500/15 text-amber-400'
                              : 'bg-muted text-muted-foreground',
                          )}
                          title={
                            (groupSizeByKey.get(line.key)?.identical ?? 0) > 0
                              ? 'This exact row (same quantity and price) appears more than once in the document'
                              : 'Same description on several rows - one decision links all of them'
                          }
                        >
                          <Copy className="h-3 w-3" />
                          {groupSizeByKey.get(line.key)?.size} rows
                        </span>
                      )}
                    </Label>
                    <Input
                      value={line.supplierLabel}
                      onChange={(e) => setLine(line.key, { supplierLabel: e.target.value })}
                      placeholder="Automatic Sweeping Robot"
                      className="h-9"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      Their code
                    </Label>
                    <Input
                      value={line.supplierCode}
                      onChange={(e) => setLine(line.key, { supplierCode: e.target.value })}
                      placeholder="DT1057"
                      className="h-9 w-24 font-mono"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      Qty
                    </Label>
                    <Input
                      value={line.qty}
                      onChange={(e) => setLine(line.key, { qty: e.target.value })}
                      inputMode="decimal"
                      className="h-9 w-20 font-mono tabular-nums"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${line.key}-supplier-price`} className="text-sm text-muted-foreground">
                      Supplier unit price — as printed
                    </Label>
                    <Input
                      id={`${line.key}-supplier-price`}
                      value={line.unitPriceGross}
                      onChange={(e) => setLine(line.key, { unitPriceGross: e.target.value })}
                      inputMode="decimal"
                      placeholder="Enter price"
                      aria-describedby={`${line.key}-price-hint`}
                      className="h-9 w-44 font-mono tabular-nums"
                    />
                    <p id={`${line.key}-price-hint`} className="text-sm text-muted-foreground">Do not add VAT or deduct a discount here.</p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${line.key}-supplier-unit`}>Supplier unit</Label>
                    <Input id={`${line.key}-supplier-unit`} value={line.unit} onChange={(e)=>setLine(line.key,{unit:e.target.value})} placeholder="As printed" className="w-32" />
                  </div>
                  {/* Net is shown, never typed - it is derived, and the database
                      generates the stored copy from the same formula. */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove line ${index + 1}`}
                    onClick={() => {
                      const nextLines = linesRef.current.length === 1 ? [blankLine()] : linesRef.current.filter((l) => l.key !== line.key)
                      linesRef.current = nextLines
                      setLines(nextLines)
                      scheduleRecheck()
                      setAnalysis((p) => {
                        const { [line.key]: _drop, ...rest } = p
                        return rest
                      })
                    }}
                    className="h-9 w-9 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {line.supplierLabel.trim() && (
                  <div className="border-t border-border/60 px-3 py-3">
                    <SupplierUnitCost amounts={unitAmounts} checking={!a && (recheckDue || pending)} />
                    {receipt.status !== 'verified' && <p className="text-sm leading-relaxed text-muted-foreground">These amounts are provisional until the document checks are resolved.</p>}
                    <ReceiptLineEvidenceEditor line={receiptDocument.lines.find((item)=>item.key===line.key) ?? {key:line.key,label:line.supplierLabel,code:line.supplierCode||null,qty:nullableNumber(line.qty),unitPrice:nullableNumber(line.unitPriceGross),lineTotal:nullableNumber(line.lineTotal)}}
                      onChange={(patch)=>setLine(line.key,{ evidence:{ ...(receiptDocument.lines.find((item)=>item.key===line.key)!),...patch },
                        ...('lineTotal' in patch ? {lineTotal:patch.lineTotal==null?'':String(patch.lineTotal)} : {}) })} />
                    <ReceiptIssues issues={receipt.issues.filter((issue)=>issue.lineKey===line.key)} />
                    {a?.supplierConflict && <Alert><AlertDescription>{a.supplierConflict}</AlertDescription></Alert>}
                  </div>
                )}

                {/* A row whose answer has been dropped and is on its way back.
                    Without this the row is bare - which is what the owner saw
                    and read as the line having gone dead. */}
                {!a && line.supplierLabel.trim() && (recheckDue || pending) && (
                  <div className="flex items-center gap-2 border-t border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Checking against the catalogue and import costs...
                  </div>
                )}

                {/* The cross-check */}
                {a && (
                  <div className="flex flex-col gap-3 border-t border-border/60 bg-muted/20 p-3">
                    <div className="flex flex-wrap items-center gap-3">
                      {tone && Icon && (
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
                            tone.className,
                          )}
                        >
                          <Icon className="h-3 w-3" />
                          {tone.label}
                        </span>
                      )}
                      <span className="text-xs leading-relaxed text-muted-foreground">
                        {a.comparison.message}
                        {a.productImportReference && ` Product-level import background: ${rs(a.productImportReference.unitCost)}/unit across ${a.productImportReference.count} imports; capacity or variant is not recorded.`}
                      </span>
                      {a.comparison.totalDifference != null && Number(line.qty) > 0 && (
                        <span
                          className={cn(
                            'font-mono text-xs tabular-nums',
                            a.comparison.totalDifference > 0 ? 'text-amber-400' : 'text-emerald-400',
                          )}
                        >
                          {a.comparison.totalDifference > 0 ? '+' : '-'}
                          {rs(Math.abs(a.comparison.totalDifference))} on {line.qty}
                        </span>
                      )}
                    </div>

                    {/*
                     * ALREADY IN STOCK. Distinct from the price verdict, because
                     * the cheapest possible purchase is the one you do not make.
                     */}
                    {a.comparison.stockCoversQty && (
                      <p className="flex items-start gap-2 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs leading-relaxed text-sky-300">
                        <Package className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>
                          {/*
                            * Past tense on purpose. The purchase has already
                            * happened, so telling the owner to "check whether
                            * this needs buying" would be advice about a
                            * decision he cannot now change - the useful fact is
                            * simply that stock was already there.
                            */}
                          Stock already covered this: {a.comparison.stockOnHand} on hand against{' '}
                          {line.qty} bought.
                        </span>
                      </p>
                    )}

                    {/*
                     * A mis-linked import PO, surfaced instead of silently
                     * dropped. This is how "Sweeping Robot" came to carry a
                     * Rs 3,104/unit "Cleaning Cart" order - showing it is the
                     * only way the link ever gets fixed.
                     */}
                    {a.suspectImports.length > 0 && (
                      <p className="flex items-start gap-2 rounded-md border border-border bg-background/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>
                          Ignored {a.suspectImports.length} import{a.suspectImports.length === 1 ? '' : 's'} priced far
                          from this product&apos;s usual landed cost
                          {a.suspectImports[0].label ? ` (e.g. "${a.suspectImports[0].label}" at ${rs(a.suspectImports[0].landedUnitCost)}/unit)` : ''}
                          . Likely attached to the wrong product.
                        </span>
                      </p>
                    )}

                    {/* The link: made automatically, or still asking */}
                    {line.productId ? (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Check
                          className={cn(
                            'h-3.5 w-3.5',
                            line.matchMethod === 'auto' ? 'text-sky-400' : 'text-emerald-400',
                          )}
                        />
                        {/*
                         * The badge is not decoration: an automatic link and a
                         * link a person chose carry different weight, and the
                         * buyer must be able to tell at a glance which of the
                         * two they are looking at before saving.
                         */}
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider',
                            line.matchMethod === 'auto'
                              ? 'bg-sky-500/10 text-sky-300'
                              : 'bg-emerald-500/10 text-emerald-300',
                          )}
                        >
                          {line.matchMethod === 'auto'
                            ? 'Auto-linked'
                            : line.matchMethod === 'created'
                              ? 'Created'
                              : 'You chose'}
                        </span>
                        {linkedProduct?.imageUrl && <ProductThumb src={linkedProduct.imageUrl} alt="" className="size-8 shrink-0 rounded" />}
                        <span className="font-medium">{linkedName}</span>
                        {line.matchMethod === 'auto' && a.autoLink.link && (
                          <span className="text-muted-foreground">— {a.autoLink.reason}</span>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => clearLink(line.key)}
                          className="h-6 px-2 text-xs text-muted-foreground"
                        >
                          <X className="mr-1 h-3 w-3" />
                          Change
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                          {line.linkCleared
                            ? 'Link removed - pick another product'
                            : 'Needs your decision'}
                        </span>
                        {/*
                         * WHY this line was not linked for them. Without it, an
                         * unlinked row among linked ones looks like the feature
                         * simply failed.
                         */}
                        {!line.linkCleared && !a.autoLink.link && (
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {a.autoLink.reason}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          {/*
                           * THE FULL LIST comes first. The ranked guesses below
                           * are quicker when one of them is right; when none is,
                           * the buyer must still be able to reach every product,
                           * as the PO import has always allowed. Picking here is
                           * 'manual' (the ranking did not offer it), applies to
                           * every row with this description, and teaches the
                           * alias - the same path as accepting a guess.
                           */}
                          <ProductPicker
                            products={products}
                            onPick={(p) => confirmProduct(line.key, p.id, p.name, 'manual')}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => createProduct(line.key)}
                            disabled={creating !== null || !line.supplierLabel.trim()}
                            className="h-7 px-2.5 text-xs"
                          >
                            <Plus className="mr-1 h-3 w-3" />
                            Create &quot;{line.supplierLabel.trim() || 'product'}&quot; in inventory
                          </Button>
                        </div>
                        {a.candidates.length === 0 ? (
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            Nothing in the catalogue resembles this wording. If it exists under a
                            different name, pick it from the catalogue above; otherwise create it, or
                            save the line unlinked.
                          </p>
                        ) : (
                          <ul className="flex flex-col gap-1.5">
                            {a.candidates.map((candidate) => {
                              const current = productsById.get(candidate.productId)
                              return current ? { ...candidate, name: current.name, imageUrl: current.imageUrl } : candidate
                            }).map((c, i) => (
                              <li key={c.productId}>
                                <button
                                  type="button"
                                  // Accepting the top suggestion is 'confirmed';
                                  // reaching past it is 'manual'. Stored, so a
                                  // habit of overriding is visible later.
                                  onClick={() =>
                                    confirmProduct(
                                      line.key,
                                      c.productId,
                                      c.name,
                                      i === 0 ? 'confirmed' : 'manual',
                                    )
                                  }
                                  className="flex w-full items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-left transition-colors hover:border-primary/50 hover:bg-accent"
                                >
                                  <ProductThumb
                                    src={c.imageUrl}
                                    alt=""
                                    className="h-8 w-8 rounded"
                                    fallback={
                                      <span className="flex h-8 w-8 items-center justify-center rounded bg-muted text-xs text-muted-foreground">
                                        {c.name.slice(0, 1).toUpperCase()}
                                      </span>
                                    }
                                  />
                                  <span className="flex min-w-0 flex-1 flex-col">
                                    <span className="truncate text-sm">{c.name}</span>
                                    <span className="truncate text-[11px] text-muted-foreground">
                                      {c.reason}
                                    </span>
                                  </span>
                                  {/*
                                   * IMPORT HISTORY IS THE DECIDING EVIDENCE, so
                                   * it sits on the button. The duplicate decoy
                                   * "Automatic Sweeping Robot" shows 0 imports
                                   * next to the real row's 3 - which is what
                                   * makes the right choice obvious. The ranking
                                   * score is deliberately NOT shown: the decoy
                                   * scores higher on name alone, and printing
                                   * that would argue for the wrong answer.
                                   */}
                                  <span className="shrink-0 text-right font-mono text-[11px] tabular-nums">
                                    <span
                                      className={cn(
                                        c.importCount > 0 ? 'text-foreground/80' : 'text-muted-foreground/60',
                                      )}
                                    >
                                      {c.importCount} import{c.importCount === 1 ? '' : 's'}
                                    </span>
                                    {c.landedUnitCost != null && (
                                      <span className="block text-muted-foreground">
                                        {rs(c.landedUnitCost)}/u
                                      </span>
                                    )}
                                  </span>
                                  <span className="w-16 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                                    stock {c.stockOnHand ?? '-'}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {line.productId && (
                  <>
                    <ProductPricingStatus
                      product={linkedProduct}
                      productId={line.productId}
                      productName={linkedName}
                      lineKey={line.key}
                      variantId={line.variantId}
                      onRequest={setPricingRequest}
                    />
                    {(line.variantId || linkedProduct?.pricing.has_variants || linkedProduct?.variants?.length || !linkedProduct?.variants) && (
                      <div className="border-t border-border/60 px-3 py-3">
                        <div className="flex flex-col gap-3">
                          <p className="text-sm font-medium">{linkedName}</p>
                          <ExistingVariantPicker
                            id={`${line.key}-variant`} product={linkedProduct} value={line.variantId} source={line.variantSource}
                            onChange={(variantId) => setLine(line.key, { variantId, variantSource: 'manual', variantCleared: !variantId })}
                            loadError={Boolean(catalogueError)} loading={catalogueRefreshing}
                            onRefresh={() => { void refreshCatalogue().then(() => scheduleRecheck()).catch(() => {}) }}
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </article>
            )
          })}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Totals + the VAT section                                         */}
      {/* ---------------------------------------------------------------- */}
      {/* Says what is NOT counted. A total that silently omits half the
          document is worse than no total. */}
      {linkStats.total > 0 && totals.pendingCheck > 0 && (
        <p role="status" className="text-sm leading-relaxed text-muted-foreground">
          {recheckDue || pending ? 'Recalculating purchase totals…' : 'Purchase totals are unavailable until the current prices have been checked.'}
        </p>
      )}
      {receipt.totals && totals.analysed > 0 && totals.pendingCheck === 0 && (
        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">
              VAT (accounting)
            </h3>
            <dl className="flex flex-col gap-2 text-sm">
              <Row label="Goods and charges, excluding VAT" value={rs(totals.net)} />
              <Row label="VAT, including printed line overrides" value={rs(totals.vat)} />
              <Row label="Total payable" value={rs(totals.gross)} strong />
              <Row
                label={vatReclaimable ? 'Input VAT reclaimable' : 'Input VAT reclaimable (none)'}
                value={rs(totals.reclaimable)}
                className={vatReclaimable ? 'text-emerald-400' : 'text-muted-foreground'}
              />
              <div className="my-1 border-t border-border/60" />
              <Row label="True cost after reclaim" value={rs(totals.effective)} strong />
            </dl>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Totals use the shared document calculation, including charges and documented rounding. Imported unit costs are not multiplied from rounded display prices.
            </p>
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              Reclaimable VAT is a receivable from the MRA, not a cost, so it is recorded here and
              kept out of the price comparison above.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">
              Against importing
            </h3>
            <dl className="flex flex-col gap-2 text-sm">
              <Row
                label={`Dearer than China (${totals.dearerCount} line${totals.dearerCount === 1 ? '' : 's'})`}
                value={totals.dearerExtra ? '+' + rs(totals.dearerExtra) : '-'}
                className={totals.dearerExtra ? 'text-amber-400' : 'text-muted-foreground'}
              />
              <Row
                label="Saving where local is cheaper"
                value={totals.cheaperSaving ? '-' + rs(totals.cheaperSaving) : '-'}
                className={totals.cheaperSaving ? 'text-emerald-400' : 'text-muted-foreground'}
              />
              <Row
                label="Lines already covered by stock"
                value={String(totals.stockCovered)}
                className={totals.stockCovered ? 'text-sky-400' : 'text-muted-foreground'}
              />
              <Row
                label="Lines not linked to a product"
                value={String(totals.unlinked)}
                className={totals.unlinked ? 'text-muted-foreground' : 'text-muted-foreground'}
              />
            </dl>

          </div>
        </section>
      )}

      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
          {error}
        </p>
      )}
      {/*
        * Catalogue changes get their own neutral banner, kept apart from
        * `error` and `saved`: creating a product is neither a failure nor the
        * purchase being saved, and the message often says a row was REUSED
        * rather than created - which the buyer needs to actually read.
        */}
      {notice && (
        <p className="flex items-start justify-between gap-3 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="shrink-0 text-sky-300/70 hover:text-sky-200"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </p>
      )}
      {saved && (
        <Alert><AlertDescription><p>{saved.message}</p><Button asChild variant="outline" size="sm"><Link href={`/dashboard/purchasing/local/history/${saved.id}`}>View saved purchase</Link></Button></AlertDescription></Alert>
      )}

      {hasInvalidVariant && <Alert variant="destructive"><AlertDescription>Correct or clear the unavailable variant on the affected row before saving. Supplier amounts have not changed.</AlertDescription></Alert>}
      <section aria-label="Record purchase confirmation" className="rounded-lg border border-border bg-card p-4 text-card-foreground">
        <PurchaseAcknowledgement actual={actualPurchase} onActual={setActualPurchase} requiresReason={requiresReason}
          reason={currentReason} onReason={(reason)=>setAcknowledgement({revision:reviewRevision,reason})} />
      </section>
      <div className="flex flex-wrap items-center justify-end gap-3 pb-8">
        {totals.unlinked > 0 && (
          <span className="text-xs text-muted-foreground">
            Unlinked lines are saved as unmatched - they will not claim &quot;never imported&quot;.
          </span>
        )}
        <Button type="button" onClick={save} disabled={pending || !canSave}>
          {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Save purchase
        </Button>
      </div>

      <CreateProductDialog
        request={creating}
        unitAmounts={creating && receipt.status === 'verified' ? unitAmountsFor(creating.lineKey) : null}
        costChecking={!!creating && !unitAmountsFor(creating.lineKey) && (recheckDue || pending)}
        requiresCurrentCost={!!creating && receipt.status === 'verified' && lines.some((line) => line.key === creating.lineKey && (Number(line.unitPriceGross) > 0 || Number(line.lineTotal) > 0))}
        onRecheck={analyse}
        onOpenChange={(open) => {
          if (!open) setCreating(null)
        }}
        onDone={onCreateDone}
      />
      {pricingRequest && (
        <ProductPricingDialog
          key={pricingRequest.productId}
          request={pricingRequest}
          unitAmounts={unitAmountsFor(pricingRequest.lineKey)}
          costChecking={!unitAmountsFor(pricingRequest.lineKey) && (recheckDue || pending)}
          onClose={() => setPricingRequest(null)}
          onProduct={rememberProduct}
          onSaved={(product) => {
            rememberProduct(product)
            setNotice(`Updated "${product.name}" in Inventory. Product details and selling prices are saved; purchase cost, stock and this unsaved receipt are unchanged.`)
          }}
        />
      )}
    </div>
  )
}

function Row({
  label,
  value,
  strong,
  className,
}: {
  label: string
  value: string
  strong?: boolean
  className?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'font-mono text-sm tabular-nums',
          strong && 'font-semibold text-foreground',
          className,
        )}
      >
        {value}
      </dd>
    </div>
  )
}
