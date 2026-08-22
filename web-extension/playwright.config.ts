import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'

const extensionPath = path.resolve('.output/chrome-mv3')

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  // Every scenario launches one or two persistent Chromium profiles. Running
  // them concurrently makes extension/service-worker startup contend for
  // browser resources and can exhaust the per-test timeout before assertions
  // begin. Keep the extension lifecycle suite deterministic and run scenario
  // matrices in separate CI jobs when parallelism is needed.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI'] ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:47173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: [
    {
      command: 'pnpm exec vite tests/fixtures/pages --host 127.0.0.1 --port 47173 --strictPort',
      url: 'http://127.0.0.1:47173/basic.html',
      reuseExistingServer: !process.env['CI'],
      timeout: 30_000
    },
    {
      command:
        'pnpm exec vite tests/fixtures/cross-origin --host 127.0.0.1 --port 47174 --strictPort',
      url: 'http://127.0.0.1:47174/cross-origin-frame.html',
      reuseExistingServer: !process.env['CI'],
      timeout: 30_000
    }
  ],
  projects: [
    {
      name: 'chromium-extension',
      use: { ...devices['Desktop Chrome'], channel: 'chromium', launchOptions: { headless: true } },
      metadata: { extensionPath }
    }
  ]
})
