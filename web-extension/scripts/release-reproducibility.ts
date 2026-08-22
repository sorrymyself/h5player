import { readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseReleaseBundleArgs } from './release-package'
import { createReleaseBundle } from './release/release-bundle'
import { sha256 } from './release/hash'
import { verifyReleaseBundle } from './release/verify-bundle'

async function directoryHashes(directory: string): Promise<Map<string, string>> {
  const entries = await readdir(directory, { withFileTypes: true })
  const result = new Map<string, string>()
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    if (!entry.isFile()) throw new Error(`Reproducibility output contains non-file: ${entry.name}`)
    result.set(entry.name, sha256(await readFile(path.join(directory, entry.name))))
  }
  return result
}

function compareHashes(first: Map<string, string>, second: Map<string, string>): void {
  const files = [...new Set([...first.keys(), ...second.keys()])].sort()
  const differences = files.filter((file) => first.get(file) !== second.get(file))
  if (differences.length > 0) {
    throw new Error(`Release bundle is not reproducible: ${differences.join(', ')}`)
  }
}

async function main(): Promise<void> {
  const cwd = process.cwd()
  const options = parseReleaseBundleArgs(process.argv.slice(2))
  const secondaryOutput = `${options.outputDirectory}.reproducibility-secondary`
  const gateOverrides = options.gateOverrides.some((gate) => gate.id === 'reproducibility')
    ? options.gateOverrides
    : [
        ...options.gateOverrides,
        {
          id: 'reproducibility' as const,
          status: 'passed' as const,
          evidence:
            'two sequential WXT builds in the same checkout compared byte-for-byte by release-reproducibility.ts; environment isolation is not claimed'
        }
      ]
  const primary = await createReleaseBundle({ cwd, ...options, gateOverrides })
  try {
    const secondary = await createReleaseBundle({
      cwd,
      ...options,
      outputDirectory: secondaryOutput,
      gateOverrides
    })
    compareHashes(
      await directoryHashes(primary.outputDirectory),
      await directoryHashes(secondary.outputDirectory)
    )
    await verifyReleaseBundle(primary.outputDirectory)
  } finally {
    await rm(secondaryOutput, { recursive: true, force: true })
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        passed: true,
        outputDirectory: path.relative(cwd, primary.outputDirectory),
        releaseVersion: primary.profile.releaseVersion,
        comparedFiles: primary.files.length
      },
      null,
      2
    )}\n`
  )
}

function isDirectExecution(): boolean {
  const invokedPath = process.argv[1]
  return (
    invokedPath !== undefined && pathToFileURL(path.resolve(invokedPath)).href === import.meta.url
  )
}

if (isDirectExecution()) void main()
