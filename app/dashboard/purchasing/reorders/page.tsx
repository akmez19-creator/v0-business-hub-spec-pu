import { requireBuyer } from '@/lib/local-purchasing/auth'
import { loadReorderCatalogue, loadReorderWorkspace } from '@/lib/purchase-orders/reorder-service'
import { ReorderList } from '@/components/purchase-orders/reorder-list'
import { loadResearchContexts, loadSavedResearch } from '@/lib/purchase-orders/1688-check-service'
import { loadSupplierQuality } from '@/lib/purchase-orders/supplier-quality'
import type { ComparisonContext1688, SavedCheck1688, SupplierQualitySummary } from '@/lib/purchase-orders/1688-types'
import { loadResearchQueue } from '@/lib/purchase-orders/1688-queue'
import { loadSourcingSelections } from '@/lib/purchase-orders/1688-sourcing-service'
import type { ResearchQueueStatus, SourcingSelection } from '@/lib/purchase-orders/1688-sourcing-types'

export const metadata = {
  title: 'Reorders | China Imports | Business Hub',
  description: 'Background 1688 research, photographed Inventory SKU review and saved replacement proposals. Explicit confirmation records separate new imports without rewriting purchasing history.',
}

export default async function ReordersPage() {
  const { db } = await requireBuyer()
  const catalogue = await loadReorderCatalogue(db)
  const workspace = await loadReorderWorkspace(db, catalogue)
  const activeItems = workspace.savedItems.filter(item => item.status !== 'excluded')
  let contexts: Record<string, ComparisonContext1688> = {}
  let initialChecks: SavedCheck1688[] = []
  let initialQuality: SupplierQualitySummary[] = []
  let researchError: string | null = null
  let initialQueue: ResearchQueueStatus | undefined
  let initialSelections: SourcingSelection[] = []
  try {
    ;[contexts, initialQuality] = await Promise.all([
      loadResearchContexts(db, activeItems, catalogue.references),
      loadSupplierQuality(db),
    ])
    ;[initialChecks, initialQueue, initialSelections] = await Promise.all([loadSavedResearch(db, contexts), loadResearchQueue(db), loadSourcingSelections(db)])
  } catch {
    researchError = 'Saved research or supplier warnings could not be loaded. Reload before starting paid checks. Your reorder quantities and cost references are unchanged.'
  }
  return <ReorderList catalogue={catalogue} items={workspace.savedItems} contexts={contexts} initialChecks={initialChecks} initialQuality={initialQuality} initialQueue={initialQueue} initialSelections={initialSelections} researchError={researchError} />
}
