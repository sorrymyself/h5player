import { describe, expect, it } from 'vitest'
import {
  artifactFileName,
  parseExtensionVersion,
  parseReleaseChannel,
  parseReleaseSequence,
  resolveReleaseProfile
} from '../../src/release'

describe('release profile policy', () => {
  it('maps the package version and default dev channel to a browser-safe version', () => {
    const profile = resolveReleaseProfile({ packageVersion: '0.1.0' })

    expect(profile).toMatchObject({
      channel: 'dev',
      sequence: 0,
      packageVersion: '0.1.0',
      releaseVersion: '0.1.0-dev.0',
      manifestVersion: '0.1.0.10000',
      manifestName: 'H5Player Web Extension (Dev)',
      production: false
    })
  })

  it.each([
    ['alpha', 7, '0.1.0-alpha.7', '0.1.0.20007'],
    ['beta', 12, '0.1.0-beta.12', '0.1.0.30012'],
    ['rc', 2, '0.1.0-rc.2', '0.1.0.40002'],
    ['stable', 0, '0.1.0', '0.1.0.60000']
  ] as const)(
    'maps %s builds without changing the base package version',
    (channel, sequence, releaseVersion, manifestVersion) => {
      expect(resolveReleaseProfile({ packageVersion: '0.1.0', channel, sequence })).toMatchObject({
        channel,
        sequence,
        releaseVersion,
        manifestVersion,
        production: true
      })
    }
  )

  it('uses an explicit prerelease package version as the release identity', () => {
    expect(
      resolveReleaseProfile({ packageVersion: '1.2.3-beta.4', channel: 'beta' })
    ).toMatchObject({
      sequence: 4,
      releaseVersion: '1.2.3-beta.4',
      manifestVersion: '1.2.3.30004'
    })
  })

  it('creates deterministic browser artifact names', () => {
    const profile = resolveReleaseProfile({ packageVersion: '1.2.3', channel: 'rc', sequence: 8 })
    expect(artifactFileName(profile, 'chrome')).toBe('h5player-webext-1.2.3-rc.8-chrome.zip')
    expect(artifactFileName(profile, 'firefox')).toBe('h5player-webext-1.2.3-rc.8-firefox.zip')
  })

  it('parses valid values and rejects ambiguous version inputs', () => {
    expect(parseExtensionVersion('12.34.56-alpha.9')).toEqual({
      major: 12,
      minor: 34,
      patch: 56,
      prereleaseChannel: 'alpha',
      prereleaseSequence: 9
    })
    expect(parseReleaseChannel(undefined)).toBe('dev')
    expect(parseReleaseSequence(undefined)).toBe(0)
    expect(parseReleaseSequence('9999')).toBe(9999)

    expect(() => parseExtensionVersion('1.2')).toThrow(/SemVer/)
    expect(() => parseExtensionVersion('1.2.3+local')).toThrow(/build metadata/)
    expect(() => parseExtensionVersion('1.2.3-preview.1')).toThrow(/Prerelease/)
    expect(() => parseExtensionVersion('1.2.3-beta.01')).toThrow(/Prerelease/)
    expect(() => parseExtensionVersion('65536.0.0')).toThrow(/major/)
    expect(() => parseReleaseChannel('preview')).toThrow(/Unsupported/)
    expect(() => parseReleaseSequence(-1)).toThrow(/between/)
    expect(() => parseReleaseSequence('01')).toThrow(/between/)
    expect(() => parseReleaseSequence('1e2')).toThrow(/between/)
    expect(() => parseReleaseSequence(10_000)).toThrow(/between/)
  })

  it('rejects channel, sequence, and stable policy drift', () => {
    expect(() =>
      resolveReleaseProfile({ packageVersion: '1.2.3-beta.2', channel: 'alpha' })
    ).toThrow(/does not match/)
    expect(() =>
      resolveReleaseProfile({ packageVersion: '1.2.3-beta.2', channel: 'beta', sequence: 3 })
    ).toThrow(/sequence/)
    expect(() =>
      resolveReleaseProfile({ packageVersion: '1.2.3-beta.2', channel: 'stable' })
    ).toThrow(/does not match/)
    expect(() =>
      resolveReleaseProfile({ packageVersion: '1.2.3', channel: 'stable', sequence: 1 })
    ).toThrow(/Stable/)
  })
})
