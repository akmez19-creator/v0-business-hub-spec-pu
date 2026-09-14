import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { workflow } from '@workflow/vitest'

const project = fileURLToPath(new URL('../', import.meta.url))
const isolated = await mkdtemp(join(tmpdir(), 'reorder-1688-workflow-'))
await mkdir(join(isolated, 'workflows'))
await mkdir(join(isolated, 'lib/purchase-orders'), { recursive: true })
await symlink(join(project, 'node_modules'), join(isolated, 'node_modules'), 'dir')
await writeFile(join(isolated, 'package.json'), JSON.stringify({ type: 'module', dependencies: { workflow: '4.8.8' } }))
await writeFile(join(isolated, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', baseUrl: '.', paths: { '@/*': ['./*'] } } }))
// Compile the actual workflow unchanged; only its database/provider port is isolated.
await writeFile(join(isolated, 'workflows/reorder-1688.ts'), await readFile(join(project, 'workflows/reorder-1688.ts')))
await writeFile(join(isolated, 'lib/purchase-orders/1688-queue.ts'), `
const port = () => {
  const value = globalThis[Symbol.for('1688-workflow-test-port')];
  if (!value) throw new Error('Isolated workflow port is not installed');
  return value;
};
export const RUN_COLUMNS = 'id,request_key,actor_id,workflow_id,status,stop_requested,reason,created_at,updated_at';
export const queueDatabase = () => port().db;
export const advanceResearchJob = (...args) => port().advance(...args);
export const attemptUuid = (...args) => port().attemptUuid(...args);
export const queueMutation = (...args) => port().queueMutation(...args);
`)

// The SDK client transform uses process.cwd(), not its plugin options, to build workflow IDs.
process.chdir(isolated)

export default defineConfig({
  root: project,
  plugins: [workflow({ cwd: isolated, rootDir: isolated })],
  resolve: { alias: { '#research-workflow': join(isolated, 'workflows/reorder-1688.ts'), 'server-only': join(project, 'node_modules/next/dist/compiled/server-only/empty.js'), '@': project } },
  test: {
    include: ['scripts/1688-workflow.integration.test.mts'],
    environment: 'node',
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
})
