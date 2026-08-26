'use client'

import { MapPin, UserPlus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** Sentinel for "create a rider named after this contractor" in the dropdown. */
export const CREATE_RIDER_VALUE = '__create_from_contractor__'

/** Bucket for blank-rider rows that carry no Region value at all. */
export const NO_LOCALITY = '(no locality)'

/** Who covers a locality, for delivery rows that arrived with no rider named. */
export interface LocalityAssignment {
  contractorId: string | null
  riderId: string | null
  /**
   * The chosen contractor has no rider record of his own. A contractor
   * commonly rides his own deliveries, so one is created in his name at
   * import time rather than leaving the rows unassigned.
   */
  createRiderForContractor: boolean
  /** Also write this back to the locality master, not just this import. */
  saveToMaster: boolean
}

export interface LocalityGroup {
  locality: string
  count: number
  /** False when the Excel value matched no locality in the master list. */
  matched: boolean
  contractorId: string | null
  defaultRiderId: string | null
}

interface Props {
  groups: LocalityGroup[]
  contractors: { id: string; name: string }[]
  riders: { id: string; name: string }[]
  assignmentFor: (group: LocalityGroup) => LocalityAssignment
  onUpdate: (group: LocalityGroup, patch: Partial<LocalityAssignment>) => void
}

/**
 * Step 8 section: delivery rows whose Rider column is BLANK, grouped by
 * locality and filled in from whoever covers that locality.
 *
 * These rows are invisible everywhere else in the importer - the rider-mapping
 * step counts only non-empty rider names - so without this they import
 * silently unassigned.
 */
export function LocalityRiderSection({ groups, contractors, riders, assignmentFor, onUpdate }: Props) {
  if (groups.length === 0) return null

  const totalRows = groups.reduce((n, g) => n + g.count, 0)

  return (
    <div className="border-t pt-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <span className="text-sm font-medium">Rows with no rider named</span>
        </div>
        <Badge variant="secondary">
          {totalRows.toLocaleString()} rows{' · '}{groups.length} localities
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Filled in from the locality&apos;s usual contractor and rider. Change any line before
        importing - a contractor with no rider of his own gets one created in his name.
      </p>

      <ScrollArea className="h-[260px] border rounded-lg p-2">
        <div className="space-y-2">
          {groups.map((group) => {
            const assignment = assignmentFor(group)
            const contractor = contractors.find((c) => c.id === assignment.contractorId)
            const riderSelectValue = assignment.riderId
              ? assignment.riderId
              : assignment.createRiderForContractor
                ? CREATE_RIDER_VALUE
                : 'none'

            return (
              <div key={group.locality} className="p-2 rounded-md bg-muted/50 space-y-2">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate flex items-center gap-2">
                      {group.locality}
                      {!group.matched && (
                        <Badge variant="outline" className="text-[10px] font-normal">
                          not in locality list
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{group.count} deliveries</div>
                  </div>

                  <Select
                    value={assignment.contractorId || 'none'}
                    onValueChange={(v) => {
                      const contractorId = v === 'none' ? null : v
                      // Re-derive the rider for the NEW contractor instead of
                      // leaving the previous contractor's rider attached.
                      const next = assignmentFor({ ...group, contractorId, defaultRiderId: null })
                      onUpdate(group, {
                        contractorId,
                        riderId: next.riderId,
                        createRiderForContractor: next.createRiderForContractor,
                      })
                    }}
                  >
                    <SelectTrigger className="w-[170px]" aria-label={`Contractor for ${group.locality}`}>
                      <SelectValue placeholder="Contractor..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No Contractor</SelectItem>
                      {contractors.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={riderSelectValue}
                    onValueChange={(v) =>
                      onUpdate(group, {
                        riderId: v === 'none' || v === CREATE_RIDER_VALUE ? null : v,
                        createRiderForContractor: v === CREATE_RIDER_VALUE,
                      })
                    }
                  >
                    <SelectTrigger className="w-[170px]" aria-label={`Rider for ${group.locality}`}>
                      <SelectValue placeholder="Rider..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Leave unassigned</SelectItem>
                      {contractor && (
                        <SelectItem value={CREATE_RIDER_VALUE}>
                          Create rider &quot;{contractor.name}&quot;
                        </SelectItem>
                      )}
                      {riders.map((r) => (
                        <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-4 pl-1">
                  {assignment.createRiderForContractor && contractor && (
                    <span className="text-xs text-amber-600 dark:text-amber-500 flex items-center gap-1">
                      <UserPlus className="w-3 h-3" />
                      Rider &quot;{contractor.name}&quot; will be created
                    </span>
                  )}
                  {group.matched && (assignment.contractorId || assignment.riderId) && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-primary"
                        checked={assignment.saveToMaster}
                        onChange={(e) => onUpdate(group, { saveToMaster: e.target.checked })}
                        aria-label={`Save ${group.locality} to locality master`}
                      />
                      Also save as this locality&apos;s usual rider
                    </label>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}

interface GapProps {
  groups: LocalityGroup[]
  contractors: { id: string; name: string }[]
  contractorFor: (locality: string) => string | null
  onSelect: (group: LocalityGroup, contractorId: string | null) => void
}

/**
 * Step 8 section: rows that DO name a rider but would still import with an
 * empty contractor, because neither the rider nor the locality supplies one.
 *
 * Shown so the gap is closed before importing rather than discovered as blank
 * contractor columns afterwards.
 */
export function ContractorGapSection({ groups, contractors, contractorFor, onSelect }: GapProps) {
  if (groups.length === 0) return null

  const totalRows = groups.reduce((n, g) => n + g.count, 0)

  return (
    <div className="border-t pt-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <span className="text-sm font-medium">Rows that would have no contractor</span>
        </div>
        <Badge variant="secondary">
          {totalRows.toLocaleString()} rows{' · '}{groups.length} localities
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        These rows name a rider, but neither that rider nor the locality has a contractor on
        record. Pick one so the contractor column is not left empty.
      </p>

      <ScrollArea className="h-[200px] border rounded-lg p-2">
        <div className="space-y-2">
          {groups.map((group) => (
            <div key={group.locality} className="flex items-center gap-3 p-2 rounded-md bg-muted/50">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate flex items-center gap-2">
                  {group.locality}
                  {!group.matched && (
                    <Badge variant="outline" className="text-[10px] font-normal">
                      not in locality list
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">{group.count} deliveries</div>
              </div>

              <Select
                value={contractorFor(group.locality) || 'none'}
                onValueChange={(v) => onSelect(group, v === 'none' ? null : v)}
              >
                <SelectTrigger className="w-[180px]" aria-label={`Contractor for ${group.locality}`}>
                  <SelectValue placeholder="Contractor..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Leave blank</SelectItem>
                  {contractors.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
