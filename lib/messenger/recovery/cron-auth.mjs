import { createHash, timingSafeEqual } from 'node:crypto'
/** Fixed-size constant-time comparison. Missing configuration is distinct from bad credentials. */
export function cronAuthorization(header, secret) {
  if (typeof secret !== 'string' || !secret.trim() || secret.length > 512) return 'unconfigured'
  if (typeof header !== 'string' || header.length > 1024) return 'unauthorized'
  const hash = value => createHash('sha256').update(value).digest()
  return timingSafeEqual(hash(header), hash(`Bearer ${secret}`)) ? 'authorized' : 'unauthorized'
}
