import { createHash } from 'node:crypto'

/**
 * Key-sorted JSON and its sha256. Byte-for-byte identical to the helpers these
 * replaced: stored handoff event keys and payload hashes must keep matching.
 */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']'
  return '{' + Object.keys(value as object).sort().map(k => JSON.stringify(k) + ':' + stableJson((value as Record<string, unknown>)[k])).join(',') + '}'
}

export const stableHash = (value: string) => createHash('sha256').update(value).digest('hex')
