import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseReleaseSequence } from '../src/release'
import { parseGateResult, type ReleaseGateResult } from './release/evidence'
import { createReleaseBundle, type ReleaseBundleOptions } from './release/release-bundle'

type CliOptions = Omit<ReleaseBundleOptions, 'cwd' | 'gateOverrides'> & {
  gateOverrides: ReleaseGateResult[]
}

function argumentValue(args: readonly string[], index: number, label: string): string {
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${label} requires a value`)
  return value
}

export function parseReleaseBundleArgs(
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env
): CliOptions {
  let channel = environment['H5PLAYER_RELEASE_CHANNEL'] ?? 'dev'
  let sequenceInput = environment['H5PLAYER_RELEASE_SEQUENCE'] ?? '0'
  let sourceDateInput = environment['SOURCE_DATE_EPOCH'] ?? ''
  let outputDirectory = '.release/current'
  let allowDirty = false
  const gateOverrides: ReleaseGateResult[] = []

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--') continue
    if (argument === '--channel') channel = argumentValue(args, index++, argument)
    else if (argument === '--sequence') sequenceInput = argumentValue(args, index++, argument)
    else if (argument === '--source-date-epoch') {
      sourceDateInput = argumentValue(args, index++, argument)
    } else if (argument === '--output') outputDirectory = argumentValue(args, index++, argument)
    else if (argument === '--gate') {
      gateOverrides.push(parseGateResult(argumentValue(args, index++, argument)))
    } else if (argument === '--allow-dirty') allowDirty = true
    else throw new Error(`Unknown release-package argument: ${argument}`)
  }

  const sequence = parseReleaseSequence(sequenceInput)
  if (!/^(?:0|[1-9]\d*)$/.test(sourceDateInput)) {
    throw new Error('SOURCE_DATE_EPOCH must be a non-negative decimal integer')
  }
  const sourceDateEpoch = Number(sourceDateInput)
  if (!Number.isSafeInteger(sourceDateEpoch)) {
    throw new Error('SOURCE_DATE_EPOCH must be a safe integer')
  }

  return {
    channel,
    sequence,
    sourceDateEpoch,
    outputDirectory,
    allowDirty,
    gateOverrides
  }
}

async function main(): Promise<void> {
  const cwd = process.cwd()
  const options = parseReleaseBundleArgs(process.argv.slice(2))
  const result = await createReleaseBundle({ cwd, ...options })
  process.stdout.write(
    `${JSON.stringify(
      {
        outputDirectory: path.relative(cwd, result.outputDirectory),
        releaseVersion: result.profile.releaseVersion,
        manifestVersion: result.profile.manifestVersion,
        commitSha: result.commitSha,
        sourceTreeClean: result.sourceTreeClean,
        artifacts: result.artifacts.map((artifact) => ({
          file: artifact.file,
          sha256: artifact.sha256,
          size: artifact.size
        }))
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
