import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../', import.meta.url)) } },
  test: {
    include: ['scripts/auth-middleware.test.ts', 'scripts/auth-sign-in.test.ts'],
    environment: 'node',
    maxWorkers: 1,
    testTimeout: 15_000,
  },
})
