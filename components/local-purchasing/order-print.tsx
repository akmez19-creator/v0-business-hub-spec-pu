import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { OrderPrintButton } from './order-print-button'
import { moneyText } from '@/lib/local-purchasing/evidence'
import type { OrderParty, OrderSnapshot } from '@/lib/local-purchasing/order-types'
import { variantDescription } from '@/lib/products/pricing'

function Party({ label, party }: { label: string; party: OrderParty }) {
  return <section className="flex min-w-0 flex-1 flex-col gap-2"><h2 className="text-sm font-medium text-muted-foreground">{label}</h2><p className="text-lg font-semibold">{party.name}</p>{party.address && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{party.address}</p>}<p className="text-sm">{[party.brn && `BRN ${party.brn}`, party.vatNumber && `VAT ${party.vatNumber}`].filter(Boolean).join(' · ')}</p>{(party.phone || party.email) && <p className="break-words text-sm">{[party.phone, party.email].filter(Boolean).join(' · ')}</p>}</section>
}

export function LocalOrderPrint({ snapshot, status, latestRevision }: { snapshot: OrderSnapshot; status: string; latestRevision: number }) {
  const totals = snapshot.calculation.totals!
  const amounts = new Map(snapshot.calculation.lines.map((line) => [line.key, line]))
  const archive = status === 'cancelled' || latestRevision !== snapshot.revision
  return <div className="local-order-print mx-auto max-w-6xl rounded-lg bg-background p-6 font-sans text-foreground sm:p-10">
    <div className="local-order-print-controls pb-8"><div className="flex flex-wrap items-center justify-between gap-3"><Button asChild variant="outline"><Link href={`/dashboard/purchasing/local/orders/${snapshot.orderId}`}>Back to order</Link></Button><OrderPrintButton /></div></div>
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4"><div className="flex flex-col gap-2"><h1 className="text-3xl font-semibold">Purchase order</h1><p className="font-mono text-lg">{snapshot.orderNumber} · Revision {snapshot.revision}</p></div><dl className="flex flex-col gap-2 text-sm"><div className="flex justify-between gap-6"><dt>Issued</dt><dd>{snapshot.issuedAt.slice(0, 10)}</dd></div>{snapshot.expectedDate && <div className="flex justify-between gap-6"><dt>Requested delivery</dt><dd>{snapshot.expectedDate}</dd></div>}<div className="flex justify-between gap-6"><dt>Currency</dt><dd>MUR</dd></div></dl></header>
      {archive && <p className="rounded-md border border-border p-3 text-sm font-semibold">{status === 'cancelled' ? 'CANCELLED ORDER — retained for reference only.' : `SUPERSEDED REVISION — current revision is ${latestRevision}. Do not supply against this older copy.`}</p>}
      <div className="flex flex-col gap-8 sm:flex-row"><Party label="Buyer" party={snapshot.buyer} /><Party label="Supplier" party={snapshot.supplier} /></div>
      <p className="text-sm leading-relaxed">Expected prices are shown below. Please confirm any price, quantity or tax changes and quote this order number and revision on your response.</p>
      <div className="local-order-print-table overflow-x-auto"><table className="w-full border-collapse text-sm"><thead><tr className="border-y border-border"><th scope="col" className="py-3 pr-3 text-left">Supplier item / code</th><th scope="col" className="px-2 py-3 text-left">Unit</th><th scope="col" className="px-2 py-3 text-right">Qty</th><th scope="col" className="px-2 py-3 text-right">Unit price</th><th scope="col" className="px-2 py-3 text-left">Price terms</th><th scope="col" className="px-2 py-3 text-right">Payable / unit</th><th scope="col" className="py-3 pl-2 text-right">Line payable</th></tr></thead><tbody>{snapshot.lines.map((line) => {
        const amount = amounts.get(line.id)!
        return <tr key={line.id} className="border-b border-border"><td className="py-3 pr-3 align-top"><p className="break-words font-medium">{line.supplierLabel}</p>{line.supplierCode && <p className="break-words text-muted-foreground">{line.supplierCode}</p>}{line.variantSnapshot && <p className="text-muted-foreground">{variantDescription(line.variantSnapshot)}</p>}</td><td className="px-2 py-3 align-top">{line.unit || 'Not stated'}</td><td className="px-2 py-3 text-right align-top font-mono">{line.qty}</td><td className="px-2 py-3 text-right align-top font-mono">{moneyText(line.expectedUnitPrice!)}</td><td className="px-2 py-3 align-top"><p>{line.vatPercent}% VAT {line.pricesIncludeVat ? 'included' : 'added'}</p><p>{line.discountPercent ? `${line.discountPercent}% discount to apply` : 'No further discount'}</p></td><td className="px-2 py-3 text-right align-top font-mono">{moneyText(amount.rawPayable / amount.qty)}</td><td className="py-3 pl-2 text-right align-top font-mono">{moneyText(amount.payable)}</td></tr>
      })}</tbody></table></div>
      <div className="local-order-print-totals flex flex-col gap-4">
        {snapshot.terms.charges.map((charge, index) => <p key={index} className="text-sm">{charge.label}: {moneyText(charge.amount ?? 0)} · {charge.vatPercent ?? 0}% VAT {charge.pricesIncludeVat === false ? 'added' : 'included'}</p>)}
        <dl className="ml-auto flex w-full max-w-sm flex-col gap-3 text-sm">{[['Accounting net', totals.net], ['VAT', totals.vat], ['Rounding', totals.rounding], ['Total payable', totals.payable]].map(([label, value]) => <div key={String(label)} className="flex justify-between gap-6"><dt className={label === 'Total payable' ? 'font-semibold' : ''}>{label}</dt><dd className="font-mono font-semibold">{moneyText(Number(value))}</dd></div>)}</dl>
        {snapshot.notes && <section className="flex flex-col gap-2"><h2 className="text-sm font-semibold">Instructions</h2><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{snapshot.notes}</p></section>}
      </div>
      <footer className="text-sm leading-relaxed text-muted-foreground">Please quote {snapshot.orderNumber}, revision {snapshot.revision}, on your response. This purchase order is not a receipt or proof of payment.</footer>
    </div>
  </div>
}
