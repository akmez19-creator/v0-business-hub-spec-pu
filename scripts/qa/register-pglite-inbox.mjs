// QA only. Redirects `lib/messenger/pg.ts` to a PGlite-backed shim so production modules that connect
// internally (handoff-runtime's reconcileHandoffScope) run against the disposable database instead of
// the live one. tsx loads the .ts graph as CommonJS through its patched require, so the CJS resolver is
// wrapped as well as the ESM resolve hook.
// Usage: pnpm exec tsx --conditions=react-server --import ./scripts/qa/register-pglite-inbox.mjs <script>
import Module from 'node:module'
import { fileURLToPath } from 'node:url'

const shim = fileURLToPath(new URL('./pglite-inbox-shim.mts', import.meta.url))
const target = /[\\/]lib[\\/]messenger[\\/]pg\.ts$/

Module.register('./pglite-inbox-loader.mjs', import.meta.url)

const original = Module._resolveFilename
Module._resolveFilename = function (request, parent, isMain, options) {
  const resolved = original.call(this, request, parent, isMain, options)
  return target.test(resolved) ? shim : resolved
}
