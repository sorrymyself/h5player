import { gzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import {
  BUNDLE_BUDGETS,
  createBundleBudgetSummary,
  evaluateProductionOutput,
  inspectProductionOutput,
  measureBundle,
  resolveProductionOutputs,
  runBundleBudgetCli,
  validateProductionManifest
} from '../../scripts/bundle-budget'
import type {
  BundleSources,
  ProductionOutputConfig,
  ProductionOutputReport
} from '../../scripts/bundle-budget'

const productionManifest = {
  manifest_version: 3,
  permissions: ['storage', 'activeTab', 'scripting'],
  optional_host_permissions: ['<all_urls>'],
  content_scripts: []
}

function sourceWithSize(size: number): Uint8Array {
  return new Uint8Array(size).fill(97)
}

function passingSources(): BundleSources {
  return {
    background: sourceWithSize(32),
    content: sourceWithSize(32),
    'page-main': sourceWithSize(32)
  }
}

function passingReport(
  config: ProductionOutputConfig = {
    target: 'chrome-mv3',
    outputRoot: '.output/chrome-mv3'
  }
): ProductionOutputReport {
  return evaluateProductionOutput(config, productionManifest, passingSources())
}

describe('bundle budget definitions', () => {
  it('freezes the Phase 4 raw-byte thresholds and production artifact paths', () => {
    expect(BUNDLE_BUDGETS).toEqual([
      {
        id: 'background',
        relativePath: 'background.js',
        maxRawBytes: 150 * 1024
      },
      {
        id: 'content',
        relativePath: 'content-scripts/content.js',
        maxRawBytes: 250 * 1024
      },
      {
        id: 'page-main',
        relativePath: 'content-scripts/page-main.js',
        maxRawBytes: 200 * 1024
      }
    ])
  })

  it('measures raw and deterministic gzip-9 sizes while enforcing the raw threshold', () => {
    const source = sourceWithSize(150 * 1024 + 1)
    const backgroundBudget = BUNDLE_BUDGETS.find((budget) => budget.id === 'background')
    if (!backgroundBudget) throw new Error('background budget is missing')
    const measurement = measureBundle(backgroundBudget, source)

    expect(measurement.rawBytes).toBe(source.byteLength)
    expect(measurement.gzipBytes).toBe(gzipSync(source, { level: 9 }).byteLength)
    expect(measurement.rawHeadroomBytes).toBe(-1)
    expect(measurement.passed).toBe(false)
  })
})

describe('production manifest guardrails', () => {
  it('accepts optional host access with no required hosts, WAR, or static content scripts', () => {
    const result = validateProductionManifest(productionManifest, 'chrome-mv3')

    expect(result).toMatchObject({
      passed: true,
      requiredHostPermissions: [],
      webAccessibleResourceCount: 0,
      contentScriptCount: 0,
      violations: []
    })
  })

  it('rejects required host permissions declared in either MV3 field', () => {
    const result = validateProductionManifest(
      {
        ...productionManifest,
        permissions: [...productionManifest.permissions, 'https://permissions.example/*'],
        host_permissions: ['<all_urls>']
      },
      'firefox-mv3'
    )

    expect(result.requiredHostPermissions).toEqual(['<all_urls>', 'https://permissions.example/*'])
    expect(result.violations).toContainEqual(
      expect.objectContaining({ code: 'MANIFEST_REQUIRED_HOST_PERMISSIONS' })
    )
  })

  it('rejects WAR and statically registered production content scripts', () => {
    const result = validateProductionManifest(
      {
        ...productionManifest,
        content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'] }],
        web_accessible_resources: [{ resources: ['page-main.js'], matches: ['<all_urls>'] }]
      },
      'chrome-mv3'
    )

    expect(result.passed).toBe(false)
    expect(result.violations.map((violation) => violation.code)).toEqual([
      'MANIFEST_WEB_ACCESSIBLE_RESOURCES',
      'MANIFEST_CONTENT_SCRIPTS'
    ])
  })

  it('rejects malformed or non-MV3 production manifests', () => {
    const result = validateProductionManifest(
      {
        manifest_version: 2,
        host_permissions: '<all_urls>',
        web_accessible_resources: {},
        content_scripts: {}
      },
      'chrome-mv3'
    )

    expect(result.violations.map((violation) => violation.code)).toEqual([
      'MANIFEST_INVALID',
      'MANIFEST_REQUIRED_HOST_PERMISSIONS',
      'MANIFEST_WEB_ACCESSIBLE_RESOURCES',
      'MANIFEST_CONTENT_SCRIPTS'
    ])
  })
})

describe('production output evaluation', () => {
  it('reads the production manifest and all three artifact paths from an output directory', async () => {
    const output = await inspectProductionOutput({
      target: 'fixture-mv3',
      outputRoot: 'tests/fixtures/bundle-budget/passing-output'
    })

    expect(output.passed).toBe(true)
    expect(output.manifest).toMatchObject({
      requiredHostPermissions: [],
      webAccessibleResourceCount: 0,
      contentScriptCount: 0
    })
    expect(output.bundles.map(({ id }) => id)).toEqual(['background', 'content', 'page-main'])
    expect(output.bundles.every(({ rawBytes, gzipBytes }) => rawBytes > 0 && gzipBytes > 0)).toBe(
      true
    )
  })

  it('reports every bundle with raw and gzip sizes in a machine-readable summary', () => {
    const output = passingReport()
    const summary = createBundleBudgetSummary([output])

    expect(output.bundles).toHaveLength(3)
    expect(output.bundles.every((bundle) => bundle.rawBytes > 0 && bundle.gzipBytes > 0)).toBe(true)
    expect(summary).toMatchObject({
      schemaVersion: 1,
      enforcedMetric: 'rawBytes',
      gzipCompressionLevel: 9,
      passed: true,
      violations: []
    })
  })

  it('reports the precise artifact and overage when a raw budget is exceeded', () => {
    const sources: BundleSources = {
      ...passingSources(),
      content: sourceWithSize(250 * 1024 + 1)
    }
    const output = evaluateProductionOutput(
      { target: 'chrome-mv3', outputRoot: '.output/chrome-mv3' },
      productionManifest,
      sources
    )

    expect(output.passed).toBe(false)
    expect(output.violations).toEqual([
      expect.objectContaining({
        code: 'BUNDLE_RAW_BUDGET_EXCEEDED',
        path: '.output/chrome-mv3/content-scripts/content.js'
      })
    ])
  })
})

describe('bundle budget CLI', () => {
  it('defaults to both production browser outputs and accepts explicit output roots', () => {
    expect(resolveProductionOutputs([])).toEqual([
      { target: 'chrome-mv3', outputRoot: '.output/chrome-mv3' },
      { target: 'firefox-mv3', outputRoot: '.output/firefox-mv3' }
    ])
    expect(resolveProductionOutputs(['/tmp/custom-browser'])).toEqual([
      { target: 'custom-browser', outputRoot: '/tmp/custom-browser' }
    ])
  })

  it('emits one JSON summary and returns zero when all outputs pass', async () => {
    const writeOutput = vi.fn()
    const inspectOutput = vi.fn((config: ProductionOutputConfig) =>
      Promise.resolve(passingReport(config))
    )

    const exitCode = await runBundleBudgetCli([], '/extension', {
      inspectOutput,
      writeOutput
    })

    expect(exitCode).toBe(0)
    expect(inspectOutput).toHaveBeenCalledTimes(2)
    expect(writeOutput).toHaveBeenCalledOnce()
    expect(JSON.parse(String(writeOutput.mock.calls[0]?.[0]))).toMatchObject({
      passed: true,
      outputs: [{ target: 'chrome-mv3' }, { target: 'firefox-mv3' }]
    })
  })

  it('returns nonzero and preserves machine-readable violations when a bundle is over budget', async () => {
    const writeOutput = vi.fn()
    const failingSources: BundleSources = {
      ...passingSources(),
      background: sourceWithSize(150 * 1024 + 1)
    }
    const inspectOutput = vi.fn((config: ProductionOutputConfig) =>
      Promise.resolve(evaluateProductionOutput(config, productionManifest, failingSources))
    )

    const exitCode = await runBundleBudgetCli(['.output/chrome-mv3'], '/extension', {
      inspectOutput,
      writeOutput
    })
    const summary = JSON.parse(String(writeOutput.mock.calls[0]?.[0])) as {
      passed: boolean
      violations: Array<{ code: string }>
    }

    expect(exitCode).toBe(1)
    expect(summary.passed).toBe(false)
    expect(summary.violations).toContainEqual({
      code: 'BUNDLE_RAW_BUDGET_EXCEEDED',
      target: 'chrome-mv3',
      path: '.output/chrome-mv3/background.js',
      message: 'background raw size 153601 exceeds budget 153600 bytes'
    })
  })

  it('returns a JSON failure instead of throwing when an output cannot be inspected', async () => {
    const writeOutput = vi.fn()
    const inspectOutput = vi.fn(() => Promise.reject(new Error('missing build output')))

    const exitCode = await runBundleBudgetCli(['.output/missing-mv3'], '/extension', {
      inspectOutput,
      writeOutput
    })
    const summary = JSON.parse(String(writeOutput.mock.calls[0]?.[0])) as {
      passed: boolean
      violations: Array<{ code: string; message: string }>
    }

    expect(exitCode).toBe(1)
    expect(summary).toMatchObject({
      passed: false,
      violations: [{ code: 'OUTPUT_INSPECTION_FAILED', message: 'missing build output' }]
    })
  })
})
