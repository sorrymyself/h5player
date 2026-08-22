import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'live-site-smoke.spec.ts',
  timeout: 180_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/playwright-live',
  use: {
    actionTimeout: 12_000,
    navigationTimeout: 60_000
  }
})
