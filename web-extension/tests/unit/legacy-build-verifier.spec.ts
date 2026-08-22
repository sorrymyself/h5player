import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type LegacyBuildCommand,
  verifyLegacyBuild
} from '../../scripts/legacy/legacy-build-verifier'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

async function createFixture(): Promise<{
  baselinePath: string
  repositoryRoot: string
  expectedArtifact: Buffer
  originalArtifact: Buffer
}> {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'h5player-legacy-verifier-test-'))
  temporaryDirectories.push(repositoryRoot)
  const expectedArtifact = Buffer.from('isolated legacy artifact')
  const originalArtifact = Buffer.from('tracked main worktree artifact')
  const baselinePath = path.join(repositoryRoot, 'legacy-userscript.json')
  await mkdir(path.join(repositoryRoot, 'dist'), { recursive: true })
  await writeFile(path.join(repositoryRoot, 'dist/h5player.user.js'), originalArtifact)
  await writeFile(
    baselinePath,
    JSON.stringify({
      nodeVersion: '20.11.0',
      yarnVersion: '3.7.0',
      command: 'corepack yarn@3.7.0 build',
      artifact: 'dist/h5player.user.js',
      sha256: createHash('sha256').update(expectedArtifact).digest('hex'),
      bytes: expectedArtifact.byteLength,
      legacyReleaseCommit: 'fixture',
      sourcePaths: ['package.json', 'src', 'dist/h5player.user.js']
    })
  )
  return { baselinePath, repositoryRoot, expectedArtifact, originalArtifact }
}

describe('legacy build verifier', () => {
  it('builds in a detached temporary worktree and leaves the main artifact untouched', async () => {
    const fixture = await createFixture()
    let isolatedWorktree = ''
    const commands: LegacyBuildCommand[] = []
    const runCommand = async (command: LegacyBuildCommand): Promise<void> => {
      commands.push(command)
      if (
        command.file === 'git' &&
        command.args.slice(0, 3).join(' ') === 'worktree add --detach'
      ) {
        isolatedWorktree = command.args[3] ?? ''
        await mkdir(path.join(isolatedWorktree, 'dist'), { recursive: true })
      }
      if (command.args.at(-1) === 'build') {
        await writeFile(
          path.join(isolatedWorktree, 'dist/h5player.user.js'),
          fixture.expectedArtifact
        )
      }
    }

    const result = await verifyLegacyBuild({
      baselinePath: fixture.baselinePath,
      currentNodeVersion: '24.13.0',
      repositoryRoot: fixture.repositoryRoot,
      runCommand
    })

    expect(result.worktreeIsolated).toBe(true)
    expect(commands).toContainEqual({
      file: 'git',
      args: [
        'diff',
        '--quiet',
        'fixture',
        'HEAD',
        '--',
        'package.json',
        'src',
        'dist/h5player.user.js'
      ],
      cwd: fixture.repositoryRoot
    })
    expect(
      commands.some(
        (command) =>
          command.file === 'volta' &&
          command.args.slice(0, 5).join(' ') === 'run --node 20.11.0 corepack yarn@3.7.0'
      )
    ).toBe(true)
    expect(commands).toContainEqual({
      file: 'git',
      args: ['worktree', 'remove', '--force', isolatedWorktree],
      cwd: fixture.repositoryRoot
    })
    expect(await readFile(path.join(fixture.repositoryRoot, 'dist/h5player.user.js'))).toEqual(
      fixture.originalArtifact
    )
    await expect(readFile(isolatedWorktree)).rejects.toThrow()
  })

  it('cleans the detached worktree when the isolated build fails', async () => {
    const fixture = await createFixture()
    let isolatedWorktree = ''
    const commands: LegacyBuildCommand[] = []
    const runCommand = async (command: LegacyBuildCommand): Promise<void> => {
      commands.push(command)
      if (
        command.file === 'git' &&
        command.args.slice(0, 3).join(' ') === 'worktree add --detach'
      ) {
        isolatedWorktree = command.args[3] ?? ''
        await mkdir(isolatedWorktree, { recursive: true })
      }
      if (command.args.at(-1) === 'build') throw new Error('fixture build failed')
    }

    await expect(
      verifyLegacyBuild({
        baselinePath: fixture.baselinePath,
        currentNodeVersion: '20.11.0',
        repositoryRoot: fixture.repositoryRoot,
        runCommand
      })
    ).rejects.toThrow('fixture build failed')

    expect(commands).toContainEqual({
      file: 'git',
      args: ['worktree', 'remove', '--force', isolatedWorktree],
      cwd: fixture.repositoryRoot
    })
    expect(await readFile(path.join(fixture.repositoryRoot, 'dist/h5player.user.js'))).toEqual(
      fixture.originalArtifact
    )
    await expect(readFile(isolatedWorktree)).rejects.toThrow()
  })

  it('rejects legacy source drift before creating a worktree', async () => {
    const fixture = await createFixture()
    const commands: LegacyBuildCommand[] = []
    const runCommand = (command: LegacyBuildCommand): Promise<void> => {
      commands.push(command)
      if (command.file === 'git' && command.args[0] === 'diff') {
        return Promise.reject(new Error('legacy source drift'))
      }
      return Promise.resolve()
    }

    await expect(
      verifyLegacyBuild({
        baselinePath: fixture.baselinePath,
        currentNodeVersion: '20.11.0',
        repositoryRoot: fixture.repositoryRoot,
        runCommand
      })
    ).rejects.toThrow('legacy source drift')

    expect(commands.some((command) => command.args[0] === 'worktree')).toBe(false)
    expect(await readFile(path.join(fixture.repositoryRoot, 'dist/h5player.user.js'))).toEqual(
      fixture.originalArtifact
    )
  })

  it('removes the temporary checkout and prunes registration when worktree removal fails', async () => {
    const fixture = await createFixture()
    let isolatedWorktree = ''
    const commands: LegacyBuildCommand[] = []
    const runCommand = async (command: LegacyBuildCommand): Promise<void> => {
      commands.push(command)
      if (
        command.file === 'git' &&
        command.args.slice(0, 3).join(' ') === 'worktree add --detach'
      ) {
        isolatedWorktree = command.args[3] ?? ''
        await mkdir(path.join(isolatedWorktree, 'dist'), { recursive: true })
      }
      if (command.args.at(-1) === 'build') {
        await writeFile(
          path.join(isolatedWorktree, 'dist/h5player.user.js'),
          fixture.expectedArtifact
        )
      }
      if (command.args.slice(0, 3).join(' ') === 'worktree remove --force') {
        throw new Error('fixture worktree removal failed')
      }
    }

    await expect(
      verifyLegacyBuild({
        baselinePath: fixture.baselinePath,
        currentNodeVersion: '20.11.0',
        repositoryRoot: fixture.repositoryRoot,
        runCommand
      })
    ).rejects.toThrow('fixture worktree removal failed')

    expect(commands).toContainEqual({
      file: 'git',
      args: ['worktree', 'prune'],
      cwd: fixture.repositoryRoot
    })
    await expect(readFile(isolatedWorktree)).rejects.toThrow()
    expect(await readFile(path.join(fixture.repositoryRoot, 'dist/h5player.user.js'))).toEqual(
      fixture.originalArtifact
    )
  })
})
