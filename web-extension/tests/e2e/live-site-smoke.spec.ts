import { expect, test } from '@playwright/test'
import {
  liveSmokeEnabled,
  liveSmokeStrict,
  runLiveSiteSmoke,
  selectedLiveSites
} from './live-site-probe'

test.describe('production-site live smoke', () => {
  test.skip(!liveSmokeEnabled(), 'Set H5PLAYER_LIVE_SMOKE=1 to run networked production-site tests')

  for (const site of selectedLiveSites()) {
    test(`${site.label}: media instance, anchored UI, feedback and rate inheritance`, async ({
      browserName
    }, testInfo) => {
      testInfo.annotations.push({ type: 'playwright-browser', description: browserName })
      const report = await runLiveSiteSmoke(site, testInfo)
      testInfo.annotations.push({ type: 'live-outcome', description: report.outcome })
      if (report.outcome === 'blocked' || report.outcome === 'no-media') {
        testInfo.annotations.push({
          type: 'external-evidence-gap',
          description: report.navigationAttempts
            .map((attempt) => attempt.externalBlock ?? 'no-media')
            .join(', ')
        })
      }
      if (liveSmokeStrict()) {
        expect(report.violations, JSON.stringify(report.interactions, null, 2)).toEqual([])
      }
    })
  }
})
