import type { ComponentProps, ReactNode } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CmsDeliveryRow } from '@/components/admin/cms-delivery-row'

/**
 * ONE STAGE OF THE CMS FLOW.
 *
 * Stages 2, 3 and 4 were three copies of the same 22-line block on the page,
 * differing only in colour, wording and which list they mapped over. Any change
 * to how a stage looks had to be made three times, and the page was long enough
 * that the three copies had already drifted apart in small ways.
 *
 * The props are deliberately just presentation plus a list: the STAGE DECISION
 * still belongs to `cmsStage()`, which stays the single classifier for the whole
 * page, so a section, a stat card and a row badge cannot contradict each other.
 */

// Taken from the row component itself rather than restated, so this cannot drift
// when the row's props change.
type RowProps = Omit<ComponentProps<typeof CmsDeliveryRow>, 'delivery'>
type Delivery = ComponentProps<typeof CmsDeliveryRow>['delivery']

export function CmsStageSection({
  title,
  description,
  icon,
  rows,
  rowProps,
  cardClassName,
  titleClassName,
  collapsible = false,
}: {
  title: string
  description?: ReactNode
  icon: ReactNode
  rows: { d: Delivery }[]
  rowProps: RowProps
  cardClassName?: string
  titleClassName?: string
  /** Closed by default. For the long, least urgent list. */
  collapsible?: boolean
}) {
  // An empty stage renders nothing at all - it is not a stage of this day's
  // work, and an empty card reading "(0)" is noise on a page whose whole job is
  // showing what needs doing.
  if (rows.length === 0) return null

  const list = (
    <div className="space-y-3">
      {rows.map(({ d }) => (
        <CmsDeliveryRow key={d.id} delivery={d} {...rowProps} />
      ))}
    </div>
  )

  if (collapsible) {
    return (
      <Card className={cardClassName}>
        <CardContent className="pt-6">
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold">
              {icon}
              {title} ({rows.length})
              <span className="ml-auto text-xs font-normal text-muted-foreground group-open:hidden">
                show
              </span>
              <span className="ml-auto hidden text-xs font-normal text-muted-foreground group-open:inline">
                hide
              </span>
            </summary>
            <div className="mt-4">{list}</div>
          </details>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={cardClassName}>
      <CardHeader>
        <CardTitle className={`flex items-center gap-2 ${titleClassName || ''}`}>
          {icon}
          {title} ({rows.length})
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{list}</CardContent>
    </Card>
  )
}
