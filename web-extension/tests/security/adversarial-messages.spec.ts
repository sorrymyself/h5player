import { describe, expect, it } from 'vitest'
import { settingsImportPayloadSchema } from '../../src/application/settings/contracts'
import { siteReconcilePayloadSchema } from '../../src/application/site/contracts'
import { settingsPatchSchema } from '../../src/domain/settings'
import {
  createRuntimeRequest,
  parseRuntimeRequest,
  runtimeRequestEnvelopeSchema
} from '../../src/shared/protocol'

describe('adversarial message inputs', () => {
  it('rejects unknown types, fields, invalid nonce and oversized import content', () => {
    const request = createRuntimeRequest(
      'content',
      'settings.get',
      {},
      {
        sessionId: 'session-identifier-1'
      }
    )

    expect(parseRuntimeRequest({ ...request, type: 'downloads.execute' })).toBeNull()
    expect(
      parseRuntimeRequest({
        ...request,
        source: 'popup',
        type: 'site.request-permission',
        payload: { origins: ['<all_urls>'] }
      })
    ).toBeNull()
    expect(parseRuntimeRequest({ ...request, permission: 'downloads' })).toBeNull()
    expect(runtimeRequestEnvelopeSchema.safeParse({ ...request, nonce: 'short' }).success).toBe(
      false
    )
    expect(settingsImportPayloadSchema.safeParse({ content: 'x'.repeat(262_145) }).success).toBe(
      false
    )
  })

  it('does not admit script, function or permission fields into settings mutations', () => {
    expect(settingsPatchSchema.safeParse({ script: 'alert(1)' }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ permissions: ['downloads'] }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ global: { enabled: () => true } }).success).toBe(false)
    expect(
      settingsPatchSchema.safeParse({ sites: { 'javascript:alert(1)': { enabled: true } } }).success
    ).toBe(false)
  })

  it('does not accept caller-selected origins or script files during site reconciliation', () => {
    expect(
      siteReconcilePayloadSchema.safeParse({
        bootstrapCurrentTab: true,
        origins: ['https://attacker.invalid/*']
      }).success
    ).toBe(false)
    expect(
      siteReconcilePayloadSchema.safeParse({
        bootstrapCurrentTab: true,
        files: ['/content-scripts/content.js']
      }).success
    ).toBe(false)
  })
})
