import { access } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const fixtures = [
  'basic.html',
  'multi-player.html',
  'media-anchor.html',
  'media-obscured.html',
  'audio-only.html',
  'spa.html',
  'shadow-dom.html',
  'iframe.html',
  'hostile-page.html',
  'strict-csp.html'
]

describe('fixed compatibility fixtures', () => {
  it.each(fixtures)('contains %s', async (fixture) => {
    await expect(access(path.resolve('tests/fixtures/pages', fixture))).resolves.toBeUndefined()
  })
})
