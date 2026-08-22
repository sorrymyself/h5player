import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VISUAL_STATE,
  VISUAL_LIMITS,
  cloneVisualState,
  isDefaultVisualState,
  normalizeRotation,
  panVisual,
  parseVisualState,
  rotateVisual,
  serializeVisualFilter,
  serializeVisualTransform,
  setVisualFilter,
  setVisualZoom,
  toggleVisualFlip,
  visualStateEquals,
  visualStateSchema
} from '../../src/domain/visual'

describe('visual domain', () => {
  it('defines a strict serializable default and rejects unsafe state', () => {
    expect(visualStateSchema.parse(DEFAULT_VISUAL_STATE)).toEqual(DEFAULT_VISUAL_STATE)
    expect(parseVisualState(DEFAULT_VISUAL_STATE)).toEqual({
      ok: true,
      value: DEFAULT_VISUAL_STATE
    })

    for (const value of [
      { ...DEFAULT_VISUAL_STATE, zoom: 0 },
      { ...DEFAULT_VISUAL_STATE, pan: { x: Number.POSITIVE_INFINITY, y: 0 } },
      { ...DEFAULT_VISUAL_STATE, rotation: 360 },
      {
        ...DEFAULT_VISUAL_STATE,
        filters: { ...DEFAULT_VISUAL_STATE.filters, blur: VISUAL_LIMITS.maxBlur + 1 }
      },
      { ...DEFAULT_VISUAL_STATE, capture: true }
    ]) {
      const result = parseVisualState(value)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('INVALID_VISUAL_STATE')
    }
  })

  it('applies bounded immutable zoom, pan, rotation, flip and filter transitions', () => {
    const initial = cloneVisualState(DEFAULT_VISUAL_STATE)
    const zoomed = setVisualZoom(initial, 100)
    const panned = panVisual(zoomed, VISUAL_LIMITS.maxPan + 10, -25.126)
    const rotated = rotateVisual(panned, -90)
    const flipped = toggleVisualFlip(toggleVisualFlip(rotated, 'horizontal'), 'vertical')
    const filtered = setVisualFilter(setVisualFilter(flipped, 'brightness', -1), 'hue', 540)

    expect(initial).toEqual(DEFAULT_VISUAL_STATE)
    expect(filtered).toMatchObject({
      zoom: 10,
      pan: { x: 100_000, y: -25.13 },
      rotation: 270,
      flip: { horizontal: true, vertical: true },
      filters: { brightness: 0, hue: 360 }
    })
    expect(Object.isFrozen(filtered)).toBe(true)
    expect(Object.isFrozen(filtered.pan)).toBe(true)
    expect(Object.isFrozen(filtered.filters)).toBe(true)
    expect(isDefaultVisualState(initial)).toBe(true)
    expect(visualStateEquals(initial, filtered)).toBe(false)
    expect(normalizeRotation(810)).toBe(90)
  })

  it('serializes deterministic CSS without including capture or arbitrary values', () => {
    const state = setVisualFilter(
      toggleVisualFlip(
        rotateVisual(panVisual(setVisualZoom(DEFAULT_VISUAL_STATE, 1.5), 20, -10), 90),
        'horizontal'
      ),
      'contrast',
      1.25
    )

    expect(serializeVisualTransform(state)).toBe(
      'scale(1.5) translate(20px, -10px) rotate(90deg) scaleX(-1) scaleY(1)'
    )
    expect(serializeVisualFilter(state)).toBe(
      'brightness(1) contrast(1.25) saturate(1) hue-rotate(0deg) blur(0px)'
    )
    expect(`${serializeVisualTransform(state)} ${serializeVisualFilter(state)}`).not.toContain(
      'capture'
    )
  })
})
