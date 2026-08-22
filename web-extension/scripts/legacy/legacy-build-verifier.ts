import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

export type LegacyBuildBaseline = {
  nodeVersion?: string
  yarnVersion: string
  command?: string
  artifact: string
  sha256: string
  bytes: number
  legacyReleaseCommit: string
  sourcePaths?: string[]
}

export type LegacyBuildCommand = {
  file: string
  args: string[]
  cwd: string
}

type VerifyLegacyBuildOptions = {
  baselinePath: string
  repositoryRoot: string
  currentNodeVersion?: string
  runCommand?: (command: LegacyBuildCommand) => Promise<void>
}

type LegacyBuildResult = {
  artifact: string
  sha256: string
  bytes: number
  worktreeIsolated: boolean
}

const execFileAsync = promisify(execFile)

async function executeCommand(command: LegacyBuildCommand): Promise<void> {
  await execFileAsync(command.file, command.args, {
    cwd: command.cwd,
    maxBuffer: 10 * 1024 * 1024
  })
}

function createNodeCommand(
  nodeVersion: string | undefined,
  currentNodeVersion: string,
  yarnVersion: string,
  yarnArgs: string[],
  cwd: string
): LegacyBuildCommand {
  const args = [`yarn@${yarnVersion}`, ...yarnArgs]
  if (!nodeVersion || nodeVersion === currentNodeVersion) {
    return { file: 'corepack', args, cwd }
  }
  return {
    file: 'volta',
    args: ['run', '--node', nodeVersion, 'corepack', ...args],
    cwd
  }
}

async function loadBaseline(baselinePath: string): Promise<LegacyBuildBaseline> {
  return JSON.parse(await readFile(baselinePath, 'utf8')) as LegacyBuildBaseline
}

export async function verifyLegacyBuild({
  baselinePath,
  repositoryRoot,
  currentNodeVersion = process.versions.node,
  runCommand = executeCommand
}: VerifyLegacyBuildOptions): Promise<LegacyBuildResult> {
  const baseline = await loadBaseline(baselinePath)
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'h5player-legacy-build-'))
  const worktreePath = path.join(temporaryRoot, 'checkout')
  let worktreeAdded = false
  let result: LegacyBuildResult | undefined
  let operationFailure: unknown

  try {
    if (baseline.sourcePaths && baseline.sourcePaths.length > 0) {
      await runCommand({
        file: 'git',
        args: [
          'diff',
          '--quiet',
          baseline.legacyReleaseCommit,
          'HEAD',
          '--',
          ...baseline.sourcePaths
        ],
        cwd: repositoryRoot
      })
      await runCommand({
        file: 'git',
        args: ['diff', '--quiet', 'HEAD', '--', ...baseline.sourcePaths],
        cwd: repositoryRoot
      })
    }
    await runCommand({
      file: 'git',
      args: ['worktree', 'add', '--detach', worktreePath, baseline.legacyReleaseCommit],
      cwd: repositoryRoot
    })
    worktreeAdded = true

    const installCommand = createNodeCommand(
      baseline.nodeVersion,
      currentNodeVersion,
      baseline.yarnVersion,
      ['install', '--immutable'],
      worktreePath
    )
    await runCommand(installCommand)
    await runCommand(
      createNodeCommand(
        baseline.nodeVersion,
        currentNodeVersion,
        baseline.yarnVersion,
        ['build'],
        worktreePath
      )
    )

    const artifactPath = path.resolve(worktreePath, baseline.artifact)
    const artifact = await readFile(artifactPath)
    const artifactStat = await stat(artifactPath)
    const sha256 = createHash('sha256').update(artifact).digest('hex')
    if (sha256 !== baseline.sha256 || artifactStat.size !== baseline.bytes) {
      throw new Error(
        `Legacy artifact changed: expected ${baseline.sha256}/${baseline.bytes}, got ${sha256}/${artifactStat.size}`
      )
    }

    await runCommand({
      file: 'git',
      args: ['-C', worktreePath, 'diff', '--exit-code', '--', baseline.artifact],
      cwd: repositoryRoot
    })

    result = {
      artifact: baseline.artifact,
      sha256,
      bytes: artifactStat.size,
      worktreeIsolated: true
    }
  } catch (error) {
    operationFailure = error
  } finally {
    let cleanupFailure: unknown
    if (worktreeAdded) {
      try {
        await runCommand({
          file: 'git',
          args: ['worktree', 'remove', '--force', worktreePath],
          cwd: repositoryRoot
        })
      } catch (error) {
        cleanupFailure = error
      }
    }
    await rm(temporaryRoot, { recursive: true, force: true })
    if (cleanupFailure) {
      try {
        await runCommand({
          file: 'git',
          args: ['worktree', 'prune'],
          cwd: repositoryRoot
        })
      } catch {
        // Keep the original cleanup failure as the actionable error.
      }
      if (operationFailure === undefined) operationFailure = cleanupFailure
    }
  }

  if (operationFailure !== undefined) {
    throw operationFailure instanceof Error
      ? operationFailure
      : new Error('Legacy build verifier failed with a non-Error rejection')
  }
  if (!result) throw new Error('Legacy build verifier completed without a result')
  return result
}
