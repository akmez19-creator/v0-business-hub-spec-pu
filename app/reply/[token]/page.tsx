import { ReplyForm } from './reply-form'
import { getDeliveryByToken } from '@/lib/delivery-actions'

export default async function ReplyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const result = await getDeliveryByToken(token)

  if (result.error || !result.delivery) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center space-y-3 max-w-sm">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-foreground">Link Expired</h1>
          <p className="text-sm text-muted-foreground">This delivery reply link is no longer valid. Please contact your delivery agent.</p>
        </div>
      </div>
    )
  }

  const mapboxToken = process.env.MAPBOX_TOKEN || ''

  return (
    <div className="min-h-screen bg-background">
      <ReplyForm
        delivery={result.delivery}
        token={token}
        company={result.company}
        regionCenter={result.regionCenter}
        mapboxToken={mapboxToken}
      />
    </div>
  )
}
