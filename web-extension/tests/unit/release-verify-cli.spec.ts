import { describe, expect, it } from 'vitest'
import { parseReleaseBundleArgs } from '../../scripts/release-package'
import { parseReleaseVerifyArgs } from '../../scripts/release-verify'

describe('release verification CLI', () => {
  it('accepts pnpm argument separators and one optional output directory', () => {
    expect(parseReleaseVerifyArgs([])).toBe('.release/current')
    expect(parseReleaseVerifyArgs(['.release/candidate'])).toBe('.release/candidate')
    expect(parseReleaseVerifyArgs(['--', '.release/candidate'])).toBe('.release/candidate')
    expect(() => parseReleaseVerifyArgs(['one', 'two'])).toThrow(/at most one/)
  })

  it('validates raw release sequence and source-date values before numeric conversion', () => {
    expect(
      parseReleaseBundleArgs(['--sequence', '1', '--source-date-epoch', '1700000000'], {})
    ).toMatchObject({ sequence: 1, sourceDateEpoch: 1_700_000_000 })
    for (const value of ['01', '1e2', '+1', '-1']) {
      expect(() =>
        parseReleaseBundleArgs(['--sequence', value, '--source-date-epoch', '1700000000'], {})
      ).toThrow(/sequence/i)
    }
    for (const value of ['01', '1e2', '+1', '-1', '']) {
      expect(() =>
        parseReleaseBundleArgs(['--sequence', '1', '--source-date-epoch', value], {})
      ).toThrow(/SOURCE_DATE_EPOCH|requires a value/)
    }
    expect(() =>
      parseReleaseBundleArgs(
        ['--sequence', '1', '--source-date-epoch', '1700000000', '--skip-build'],
        {}
      )
    ).toThrow(/Unknown/)
  })
})
