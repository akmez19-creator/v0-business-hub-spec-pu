const shim = new URL('./pglite-inbox-shim.mts', import.meta.url).href

export async function resolve(specifier, context, next) {
  const resolved = await next(specifier, context)
  if (resolved.url.endsWith('/lib/messenger/pg.ts')) return { ...resolved, url: shim, shortCircuit: true }
  return resolved
}
