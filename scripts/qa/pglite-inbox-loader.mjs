const shim = new URL('./pglite-inbox-shim.mts', import.meta.url).href

const serverOnly = new URL('./server-only-shim.mjs', import.meta.url).href
export async function resolve(specifier, context, next) {
  if (specifier === 'server-only') return { url: serverOnly, shortCircuit: true }
  const resolved = await next(specifier, context)
  if (resolved.url.endsWith('/lib/messenger/pg.ts')) return { ...resolved, url: shim, shortCircuit: true }
  return resolved
}
