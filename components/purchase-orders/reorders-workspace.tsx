'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { ArrowLeft, ArrowRight, BookmarkPlus, ClipboardList, Loader2, Plus, RefreshCw, Settings2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from '@/components/ui/empty'
import { ProductThumb } from '@/components/ui/product-thumb'
import { getReorderWorkspaceAction } from '@/app/dashboard/purchasing/reorders/actions'
import { REORDER_LABELS, purchasingToday, type SavedReorderItem } from '@/lib/purchase-orders/workflow'
import type { ReorderCatalogue, ReorderWorkspace } from '@/lib/purchase-orders/reorder-service'
import { POEntryDialog } from './po-entry-dialog'
import { ReorderLaterDialog } from './reorder-later-dialog'
import { ReorderSettingsDialog } from './reorder-settings-dialog'
import { PurchaseError } from './reorder-fields'

export function ReordersWorkspace({ initial, catalogue }: { initial: ReorderWorkspace; catalogue: ReorderCatalogue }) {
  const {
    data = initial,
    error,
    isValidating,
    mutate,
  } = useSWR('import-reorder-workspace', getReorderWorkspaceAction, {
    fallbackData: initial,
    revalidateOnFocus: false,
    revalidateOnMount: false,
  })
  const [tab, setTab] = useState('drafts')
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [laterOpen, setLaterOpen] = useState(false)
  const [laterItem, setLaterItem] = useState<SavedReorderItem | null>(null)
  const [laterProduct, setLaterProduct] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsProduct, setSettingsProduct] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [createItems, setCreateItems] = useState<SavedReorderItem[]>([])
  const [showExcluded, setShowExcluded] = useState(false)
  const [page, setPage] = useState(0)
  // Suggestions tab acting as the reorder list: ticked products + AI urgency.
  const [pickedGuide, setPickedGuide] = useState<string[]>([])
  const [ranking, setRanking] = useState<Record<string, { urgency: 'high' | 'medium' | 'low'; reason: string }>>({})
  const [ranked, setRanked] = useState(false)
  const [rankingBusy, setRankingBusy] = useState(false)
  const [rankError, setRankError] = useState<string | null>(null)
  const refresh = () => {
    void mutate()
  }
  const term = query.trim().toLowerCase()
  const drafts = data.reorders.filter(
    (request) =>
      !term ||
      `${request.number} ${request.draft.supplierName} ${request.draft.lines.map((line) => line.productName).join(' ')}`
        .toLowerCase()
        .includes(term),
  )
  const saved = data.savedItems.filter(
    (item) =>
      (showExcluded || item.status !== 'excluded') &&
      (!term || `${item.item.productName} ${item.supplierName}`.toLowerCase().includes(term)),
  )
  const guide = useMemo(
    () =>
      data.guidance
        .filter((row) => {
          const product = catalogue.products.find((item) => item.id === row.productId)
          const held = data.savedItems.find(
            (item) =>
              item.item.productId === row.productId &&
              (item.status === 'excluded' ||
                (item.status === 'deferred' && Boolean(item.reviewDate && item.reviewDate > purchasingToday()))),
          )
          return !held && (!term || product?.name.toLowerCase().includes(term))
        })
        .sort(
          (a, b) => (b.suggestedQty ?? -1) - (a.suggestedQty ?? -1) || (a.stock ?? Infinity) - (b.stock ?? Infinity),
        ),
    [data.guidance, data.savedItems, catalogue.products, term],
  )
  // Once AI has ranked, sort the whole list by urgency (high first), keeping the
  // deterministic suggested-qty order within each urgency band.
  const urgencyOrder = { high: 0, medium: 1, low: 2 } as const
  const orderedGuide = useMemo(() => {
    if (!ranked) return guide
    return [...guide].sort(
      (a, b) =>
        urgencyOrder[ranking[a.productId]?.urgency ?? 'low'] - urgencyOrder[ranking[b.productId]?.urgency ?? 'low'],
    )
  }, [guide, ranked, ranking])
  const pages = Math.max(1, Math.ceil(orderedGuide.length / 20))
  const openLater = (item: SavedReorderItem | null, productId: string | null = null) => {
    setLaterItem(item)
    setLaterProduct(productId)
    setLaterOpen(true)
  }
  const newDraft = () => {
    setCreateItems([])
    setCreateOpen(true)
  }
  const startSaved = () => {
    setCreateItems(data.savedItems.filter((item) => selected.includes(item.id)))
    setCreateOpen(true)
  }
  // Build a draft line from a suggestion row, carrying its expected quantity.
  const guideToSaved = (row: (typeof guide)[number]): SavedReorderItem | null => {
    const product = catalogue.products.find((item) => item.id === row.productId)
    if (!product) return null
    return {
      id: crypto.randomUUID(),
      item: {
        id: crypto.randomUUID(),
        productId: product.id,
        variantId: null,
        productName: product.name,
        variantLabel: null,
        imageUrl: product.imageUrl,
        supplierLabel: product.name,
        listingUrl: '',
        sourceImportId: null,
        sourceSnapshot: null,
        qty: row.suggestedQty,
        priceCny: null,
        priceMode: 'net',
        discountPercent: 0,
        chinaFreight: null,
        chinaFreightBasis: 'fixed',
        unitsPerCarton: null,
        kgPerUnit: null,
        cbmPerUnit: null,
        unavailable: false,
        notes: '',
      },
      supplierName: '',
      status: 'active',
      priority: ranking[row.productId]?.urgency === 'high' ? 1 : 2,
      reviewDate: null,
      revision: 0,
      updatedAt: '',
    }
  }
  const createFromGuide = () => {
    const items = guide
      .filter((row) => pickedGuide.includes(row.productId))
      .map(guideToSaved)
      .filter((item): item is SavedReorderItem => item !== null)
    if (!items.length) return
    setCreateItems(items)
    setPickedGuide([])
    setCreateOpen(true)
  }
  const rankWithAi = async () => {
    setRankingBusy(true)
    setRankError(null)
    try {
      const payload = guide.slice(0, 120).map((row) => ({
        id: row.productId,
        name: catalogue.products.find((item) => item.id === row.productId)?.name ?? '',
        stock: row.stock,
        suggestedQty: row.suggestedQty,
        dailyUnits: row.dailyUnits,
        alreadyOrdered: row.alreadyOrdered,
        leadDays: row.leadDays,
        coverDays: row.coverDays,
        bufferDays: row.bufferDays,
        warnings: row.warnings,
      }))
      const res = await fetch('/api/purchase-orders/reorder-rank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: payload }),
      })
      if (!res.ok) throw new Error('AI ranking failed. Try again in a moment.')
      const result = (await res.json()) as {
        ranked?: { id: string; urgency: 'high' | 'medium' | 'low'; reason: string }[]
      }
      const map: Record<string, { urgency: 'high' | 'medium' | 'low'; reason: string }> = {}
      for (const r of result.ranked ?? []) map[r.id] = { urgency: r.urgency, reason: r.reason }
      setRanking(map)
      setRanked(true)
      setPage(0)
    } catch (cause) {
      setRankError(cause instanceof Error ? cause.message : 'AI ranking failed.')
    } finally {
      setRankingBusy(false)
    }
  }
  return (
    <div className="flex min-w-0 flex-col gap-6 font-sans">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Link
            href="/dashboard/purchasing"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            China imports
          </Link>
          <h2 className="text-2xl font-bold text-balance">Reorders</h2>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Your China buying workspace. Pick what to buy, save it for later, then review with your supplier. No
            client-order or delivery linkage.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setSettingsProduct(null)
              setSettingsOpen(true)
            }}
          >
            <Settings2 />
            Planning settings
          </Button>
          <Button onClick={newDraft}>
            <Plus />
            New reorder
          </Button>
        </div>
      </div>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value)
          setQuery('')
          setPage(0)
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="drafts">
              Drafts & confirmations{' '}
              <Badge variant="secondary">
                {data.reorders.filter((item) => !['confirmed', 'cancelled'].includes(item.status)).length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="later">
              Reorder later{' '}
              <Badge variant="secondary">{data.savedItems.filter((item) => item.status !== 'excluded').length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="suggestions">Stock suggestions</TabsTrigger>
          </TabsList>
          <Button size="sm" variant="ghost" onClick={refresh} disabled={isValidating}>
            <RefreshCw className={isValidating ? 'animate-spin' : ''} />
            Refresh
          </Button>
        </div>
        <div className="py-4">
          <Input
            aria-label="Search reorders, saved products or suggestions"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(0)
            }}
            placeholder="Search product, supplier or reorder reference…"
            className="max-w-lg"
          />
        </div>
        <PurchaseError
          error={
            error
              ? 'Could not refresh purchasing data. Your last loaded data remains visible; retry before acting.'
              : null
          }
        />
        <TabsContent value="drafts">
          <Card>
            <CardHeader>
              <CardTitle>Manual supplier requests</CardTitle>
              <CardDescription>
                Draft → buyer approval → supplier review → confirmed imports. Saving and exporting do not send a message
                or record a payment.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!drafts.length ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <ClipboardList />
                    </EmptyMedia>
                    <EmptyTitle>{query ? 'No matching reorders' : 'Your next import starts here'}</EmptyTitle>
                    <EmptyDescription>
                      Add products yourself or copy previous import details. Your original records stay unchanged.
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button onClick={newDraft}>
                      <Plus />
                      Create a reorder
                    </Button>
                  </EmptyContent>
                </Empty>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Request</TableHead>
                      <TableHead>China supplier</TableHead>
                      <TableHead>Products</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead>
                        <span className="sr-only">Open request</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drafts.map((request) => (
                      <TableRow key={request.id}>
                        <TableCell>
                          <Link
                            className="font-medium text-primary hover:underline"
                            href={`/dashboard/purchasing/reorders/${request.id}`}
                          >
                            {request.number}
                          </Link>
                        </TableCell>
                        <TableCell className="max-w-64 whitespace-normal">
                          {request.draft.supplierName || 'Supplier not set'}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {request.draft.lines.slice(0, 3).map((line) => (
                              <ProductThumb key={line.id} src={line.imageUrl} className="size-9 rounded" />
                            ))}
                            <span className="text-sm">{request.draft.lines.length}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={request.status === 'confirmed' ? 'default' : 'secondary'}>
                            {REORDER_LABELS[request.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {new Date(request.updatedAt).toLocaleDateString('en-GB', { timeZone: 'Indian/Mauritius' })}
                        </TableCell>
                        <TableCell>
                          <Button asChild size="sm" variant="ghost">
                            <Link href={`/dashboard/purchasing/reorders/${request.id}`}>
                              Open
                              <ArrowRight />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="later">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <CardTitle>Products to buy later</CardTitle>
                  <CardDescription>
                    Your quantities and notes are saved, not recalculated from client orders.
                  </CardDescription>
                </div>
                <Button variant="outline" onClick={() => openLater(null)}>
                  <BookmarkPlus />
                  Add product
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={showExcluded} onCheckedChange={(v) => setShowExcluded(v === true)} />
                    Show excluded products
                  </label>
                  <Button disabled={!selected.length} onClick={startSaved}>
                    Create drafts from {selected.length} selected
                  </Button>
                </div>
                {!saved.length ? (
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>No saved products</EmptyTitle>
                      <EmptyDescription>Build your buying list without creating an import.</EmptyDescription>
                    </EmptyHeader>
                    <Button variant="outline" onClick={() => openLater(null)}>
                      Add a product
                    </Button>
                  </Empty>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          <span className="sr-only">Select</span>
                        </TableHead>
                        <TableHead>Product / variant</TableHead>
                        <TableHead>Supplier</TableHead>
                        <TableHead>Wanted</TableHead>
                        <TableHead>Priority / review</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>
                          <span className="sr-only">Edit</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {saved.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <Checkbox
                              aria-label={`Select ${item.item.productName}`}
                              checked={selected.includes(item.id)}
                              disabled={!item.item.productId || item.status === 'excluded'}
                              onCheckedChange={(value) =>
                                setSelected((ids) =>
                                  value === true ? [...new Set([...ids, item.id])] : ids.filter((id) => id !== item.id),
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <ProductThumb src={item.item.imageUrl} className="size-12 shrink-0 rounded-lg" />
                              <div className="max-w-72">
                                <p className="whitespace-normal font-medium">{item.item.productName}</p>
                                <p className="text-sm text-muted-foreground">
                                  {item.item.variantLabel || 'Variant not specified'}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="max-w-56 whitespace-normal">
                            {item.supplierName || 'Choose later'}
                          </TableCell>
                          <TableCell>{item.item.qty?.toLocaleString() ?? 'Not set'}</TableCell>
                          <TableCell>
                            <p>{item.priority === 1 ? 'High' : item.priority === 3 ? 'Low' : 'Normal'}</p>
                            <p className="text-sm text-muted-foreground">{item.reviewDate || 'No review date'}</p>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {item.status === 'active'
                                ? 'Ready'
                                : item.status === 'deferred'
                                  ? 'Deferred'
                                  : 'Excluded'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm" onClick={() => openLater(item)}>
                              Edit
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="suggestions">
          <Card>
            <CardHeader>
              <CardTitle>Products to reorder</CardTitle>
              <CardDescription>
                Products low on stock, with an expected quantity worked out from your recorded stock and the planning
                rate you set. Tick the ones to buy and create a draft in one step. Ranking with AI never changes a
                quantity, reads deliveries, or buys anything.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4">
                <PurchaseError error={data.guidanceError} />
                <PurchaseError error={rankError} />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    {pickedGuide.length
                      ? `${pickedGuide.length} product${pickedGuide.length === 1 ? '' : 's'} selected`
                      : `${orderedGuide.length} product${orderedGuide.length === 1 ? '' : 's'} need attention`}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={rankWithAi}
                      disabled={rankingBusy || !orderedGuide.length}
                    >
                      {rankingBusy ? <Loader2 className="animate-spin" /> : <Sparkles />}
                      {ranked ? 'Re-rank with AI' : 'Rank with AI'}
                    </Button>
                    <Button size="sm" onClick={createFromGuide} disabled={pickedGuide.length === 0}>
                      <Plus />
                      Create reorder{pickedGuide.length ? ` (${pickedGuide.length})` : ''}
                    </Button>
                  </div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <Checkbox
                          aria-label="Select all shown"
                          checked={
                            orderedGuide.length > 0 &&
                            orderedGuide
                              .slice(Math.min(page, pages - 1) * 20, (Math.min(page, pages - 1) + 1) * 20)
                              .every((row) => pickedGuide.includes(row.productId))
                          }
                          onCheckedChange={(value) => {
                            const shown = orderedGuide
                              .slice(Math.min(page, pages - 1) * 20, (Math.min(page, pages - 1) + 1) * 20)
                              .map((row) => row.productId)
                            setPickedGuide((ids) =>
                              value === true
                                ? [...new Set([...ids, ...shown])]
                                : ids.filter((id) => !shown.includes(id)),
                            )
                          }}
                        />
                      </TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Recorded stock</TableHead>
                      <TableHead>Already ordered</TableHead>
                      <TableHead>Expected qty</TableHead>
                      <TableHead>Priority & why</TableHead>
                      <TableHead>
                        <span className="sr-only">Assumptions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orderedGuide
                      .slice(Math.min(page, pages - 1) * 20, (Math.min(page, pages - 1) + 1) * 20)
                      .map((row) => {
                        const product = catalogue.products.find((item) => item.id === row.productId)!
                        const rank = ranking[row.productId]
                        return (
                          <TableRow key={row.productId}>
                            <TableCell>
                              <Checkbox
                                aria-label={`Select ${product.name}`}
                                checked={pickedGuide.includes(row.productId)}
                                onCheckedChange={(value) =>
                                  setPickedGuide((ids) =>
                                    value === true
                                      ? [...new Set([...ids, row.productId])]
                                      : ids.filter((id) => id !== row.productId),
                                  )
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <ProductThumb src={product.imageUrl} className="size-12 shrink-0 rounded-lg" />
                                <span className="max-w-56 whitespace-normal font-medium">{product.name}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <p className="font-medium">{row.stock?.toLocaleString() ?? 'Unknown'}</p>
                              <p className="max-w-44 whitespace-normal text-sm text-muted-foreground">
                                {row.stockLabel}
                              </p>
                            </TableCell>
                            <TableCell>
                              {row.alreadyOrdered
                                ? `${row.alreadyOrdered.toLocaleString()} · check imports`
                                : 'None recorded'}
                            </TableCell>
                            <TableCell>
                              <p className="font-medium">
                                {row.suggestedQty?.toLocaleString() ?? 'Set a rate'}
                              </p>
                              {row.dailyUnits != null && (
                                <p className="text-sm text-muted-foreground">Your rate: {row.dailyUnits}/day</p>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex max-w-md flex-col gap-2">
                                {rank && (
                                  <Badge
                                    variant={
                                      rank.urgency === 'high'
                                        ? 'destructive'
                                        : rank.urgency === 'medium'
                                          ? 'default'
                                          : 'secondary'
                                    }
                                    className="w-fit"
                                  >
                                    {rank.urgency === 'high'
                                      ? 'High priority'
                                      : rank.urgency === 'medium'
                                        ? 'Medium'
                                        : 'Low'}
                                  </Badge>
                                )}
                                <p className="whitespace-normal text-sm leading-relaxed text-muted-foreground">
                                  {rank?.reason ||
                                    row.warnings[0] ||
                                    `${row.leadDays} lead + ${row.coverDays} cover + ${row.bufferDays} buffer days, less recorded stock.`}
                                </p>
                                <details className="text-sm">
                                  <summary className="cursor-pointer text-muted-foreground">
                                    Calculation & checks
                                  </summary>
                                  <div className="flex flex-col gap-1">
                                    <p>
                                      {row.dailyUnits ?? 'Unknown'} units/day × ({row.leadDays ?? '?'} +{' '}
                                      {row.coverDays ?? '?'} + {row.bufferDays ?? '?'}) days − {row.stock ?? 'unknown'}{' '}
                                      stock. Open imports are not automatically subtracted.
                                    </p>
                                    {row.warnings.map((warning) => (
                                      <p key={warning}>{warning}</p>
                                    ))}
                                  </div>
                                </details>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setSettingsProduct(product.id)
                                  setSettingsOpen(true)
                                }}
                              >
                                Assumptions
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                  </TableBody>
                </Table>
                {!orderedGuide.length && (
                  <p className="text-sm text-muted-foreground">
                    No products match. Excluded or deferred products remain in Reorder later.
                  </p>
                )}
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    {orderedGuide.length} products · page {Math.min(page, pages - 1) + 1} of {pages}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={page === 0}
                      onClick={() => setPage((value) => value - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={page >= pages - 1}
                      onClick={() => setPage((value) => value + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      <POEntryDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        catalogue={catalogue}
        savedItems={createItems}
        onCreated={refresh}
      />
      <ReorderLaterDialog
        open={laterOpen}
        onOpenChange={setLaterOpen}
        catalogue={catalogue}
        initial={laterItem}
        productId={laterProduct}
        onSaved={refresh}
      />
      <ReorderSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        catalogue={catalogue}
        settings={data.settings}
        productId={settingsProduct}
        onSaved={refresh}
      />
    </div>
  )
}
