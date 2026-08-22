import { describe, expect, it } from 'vitest'
import { resolveReleaseProfile } from '../../src/release'
import { createCompatibilityReportHtml } from '../../scripts/compatibility-report'
import {
  createGateResults,
  createProvenance,
  createTestSummary,
  parseGateResult
} from '../../scripts/release/evidence'
import { stableJson } from '../../scripts/release/stable-json'

describe('release evidence contracts', () => {
  const profile = resolveReleaseProfile({
    packageVersion: '0.1.0',
    channel: 'beta',
    sequence: 1
  })

  it('defaults automated gates to not-run and external gates to pending', () => {
    const gates = createGateResults([parseGateResult('coverage=passed')])
    expect(gates.find((gate) => gate.id === 'coverage')?.status).toBe('passed')
    expect(gates.find((gate) => gate.id === 'chromium-e2e')?.status).toBe('not-run')
    expect(gates.find((gate) => gate.id === 'tier1-live-smoke')?.status).toBe('external-pending')
    expect(() =>
      createGateResults([parseGateResult('coverage=passed'), parseGateResult('coverage=failed')])
    ).toThrow(/Duplicate/)
    expect(() => parseGateResult('unknown=passed')).toThrow(/Unknown gate/)
    expect(() => parseGateResult('coverage=green')).toThrow(/status/)
  })

  it('keeps Stable at NO-GO when external evidence is missing', () => {
    const summary = createTestSummary({
      profile,
      sourceDateIso: '2026-08-11T00:00:00.000Z',
      commitSha: 'a'.repeat(40),
      sourceTreeClean: true,
      gates: createGateResults([parseGateResult('coverage=passed')])
    })
    expect(summary).toMatchObject({ stableEligible: false, stableDecision: 'NO-GO' })
  })

  it('requires a Stable profile, clean source, and every passed gate before review', () => {
    const stableProfile = resolveReleaseProfile({
      packageVersion: '0.1.0',
      channel: 'stable',
      sequence: 0
    })
    const gates = createGateResults([]).map((gate) => ({
      ...gate,
      status: 'passed' as const,
      evidence: 'verified fixture evidence'
    }))
    expect(
      createTestSummary({
        profile: stableProfile,
        sourceDateIso: '2026-08-11T00:00:00.000Z',
        commitSha: 'a'.repeat(40),
        sourceTreeClean: true,
        gates
      })
    ).toMatchObject({ stableEligible: true, stableDecision: 'review-required' })
    expect(
      createTestSummary({
        profile: stableProfile,
        sourceDateIso: '2026-08-11T00:00:00.000Z',
        commitSha: 'a'.repeat(40),
        sourceTreeClean: false,
        gates
      })
    ).toMatchObject({ stableEligible: false, stableDecision: 'NO-GO' })
  })

  it('creates deterministic unsigned provenance without claiming publication', () => {
    const provenance = createProvenance({
      profile,
      sourceDateIso: '2026-08-11T00:00:00.000Z',
      commitSha: 'b'.repeat(40),
      lockfileSha256: 'c'.repeat(64),
      builderId: 'local://test',
      sourceTreeClean: false,
      artifacts: [
        {
          browser: 'chrome',
          file: 'chrome.zip',
          sha256: 'd'.repeat(64),
          size: 10,
          inspection: {
            schemaVersion: 1,
            browser: 'chrome',
            entryCount: 6,
            manifestVersion: profile.manifestVersion,
            passed: true,
            violations: []
          }
        }
      ]
    })
    const first = stableJson(provenance)
    const second = stableJson({ ...provenance })
    expect(first).toBe(second)
    expect(first).toContain('https://slsa.dev/provenance/v1')
    expect(first).toContain('sourceTreeClean')
    expect(provenance).toMatchObject({
      provenanceTrust: { signed: false, status: 'unsigned' }
    })
  })

  it('escapes adapter metadata in the HTML compatibility evidence', () => {
    const html = createCompatibilityReportHtml({
      schemaVersion: 1,
      generatedAt: '2026-08-11T00:00:00.000Z',
      evidenceBoundary: 'sanitized-fixture-only',
      liveSmoke: 'not-verified',
      entries: [
        {
          id: '<script>alert(1)</script>',
          version: '1.0.0',
          tier: 1,
          supportLevel: 'preview',
          owner: 'owner',
          fixture: 'fixture.html',
          lastVerified: '2026-08-11',
          fixturePresent: true,
          fixtureSha256: 'a'.repeat(64),
          status: 'fixture-verified'
        }
      ]
    })
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>alert(1)</script>')
  })
})
