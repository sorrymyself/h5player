import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { verifyReleaseBundle } from './release/verify-bundle'

export function parseReleaseVerifyArgs(args: readonly string[]): string {
  const positional = args.filter((argument) => argument !== '--')
  if (positional.length > 1) {
    throw new Error('release:verify accepts at most one output directory')
  }
  return positional[0] ?? '.release/current'
}

async function main(): Promise<void> {
  const outputDirectory = parseReleaseVerifyArgs(process.argv.slice(2))
  const result = await verifyReleaseBundle(outputDirectory)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

function isDirectExecution(): boolean {
  const invokedPath = process.argv[1]
  return (
    invokedPath !== undefined && pathToFileURL(path.resolve(invokedPath)).href === import.meta.url
  )
}

if (isDirectExecution()) void main()
