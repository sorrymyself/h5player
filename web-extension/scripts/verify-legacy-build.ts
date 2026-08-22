import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { verifyLegacyBuild, type LegacyBuildBaseline } from './legacy/legacy-build-verifier'

async function main(): Promise<void> {
  const extensionRoot = process.cwd()
  const repositoryRoot = path.resolve(extensionRoot, '..')
  const baselinePath = path.resolve(extensionRoot, 'tests/baselines/legacy-userscript.json')
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as LegacyBuildBaseline
  const result = await verifyLegacyBuild({
    baselinePath,
    repositoryRoot
  })
  console.log(`Legacy build verified: ${result.artifact} ${result.sha256} (${result.bytes} bytes)`)
  console.log(`Legacy build checkout: detached ${baseline.legacyReleaseCommit}`)
}

function isDirectExecution(): boolean {
  const invokedPath = process.argv[1]
  return (
    invokedPath !== undefined && pathToFileURL(path.resolve(invokedPath)).href === import.meta.url
  )
}

if (isDirectExecution()) void main()
