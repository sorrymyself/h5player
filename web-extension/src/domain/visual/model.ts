import * as z from 'zod/mini'

/**
 * Visual state is deliberately bounded before it reaches a DOM style sink.
 * The limits are generous enough for normal player controls while preventing
 * malformed messages from creating unbounded CSS or pathological transforms.
 */
export const VISUAL_LIMITS = Object.freeze({
  minZoom: 0.1,
  maxZoom: 10,
  maxPan: 100_000,
  maxBlur: 100,
  maxFilterFactor: 4
})

const finiteNumber = z.number()
const zoomSchema = finiteNumber.check(z.gte(VISUAL_LIMITS.minZoom), z.lte(VISUAL_LIMITS.maxZoom))
const panSchema = finiteNumber.check(z.gte(-VISUAL_LIMITS.maxPan), z.lte(VISUAL_LIMITS.maxPan))
const rotationSchema = finiteNumber.check(z.gte(0), z.lt(360))
const filterFactorSchema = finiteNumber.check(z.gte(0), z.lte(VISUAL_LIMITS.maxFilterFactor))
const hueSchema = finiteNumber.check(z.gte(-360), z.lte(360))
const blurSchema = finiteNumber.check(z.gte(0), z.lte(VISUAL_LIMITS.maxBlur))

export const visualFilterNameSchema = z.enum([
  'brightness',
  'contrast',
  'saturation',
  'hue',
  'blur'
])

export const visualFiltersSchema = z.strictObject({
  brightness: filterFactorSchema,
  contrast: filterFactorSchema,
  saturation: filterFactorSchema,
  hue: hueSchema,
  blur: blurSchema
})

export const visualStateSchema = z.strictObject({
  zoom: zoomSchema,
  pan: z.strictObject({ x: panSchema, y: panSchema }),
  rotation: rotationSchema,
  flip: z.strictObject({ horizontal: z.boolean(), vertical: z.boolean() }),
  filters: visualFiltersSchema
})

export const fullscreenModeSchema = z.enum(['none', 'native', 'web'])
export const fullscreenRequestModeSchema = z.enum(['native', 'web'])
export const mediaPresentationStateSchema = z.strictObject({
  fullscreen: fullscreenModeSchema,
  pictureInPicture: z.boolean()
})

export type VisualFilterName = z.infer<typeof visualFilterNameSchema>
export type FullscreenMode = z.infer<typeof fullscreenRequestModeSchema>
export type MediaPresentationState = Readonly<z.infer<typeof mediaPresentationStateSchema>>
export type VisualFilters = Readonly<z.infer<typeof visualFiltersSchema>>
export type VisualState = Readonly<{
  readonly zoom: number
  readonly pan: Readonly<{ readonly x: number; readonly y: number }>
  readonly rotation: number
  readonly flip: Readonly<{ readonly horizontal: boolean; readonly vertical: boolean }>
  readonly filters: VisualFilters
}>

export const DEFAULT_VISUAL_STATE: VisualState = Object.freeze({
  zoom: 1,
  pan: Object.freeze({ x: 0, y: 0 }),
  rotation: 0,
  flip: Object.freeze({ horizontal: false, vertical: false }),
  filters: Object.freeze({
    brightness: 1,
    contrast: 1,
    saturation: 1,
    hue: 0,
    blur: 0
  })
})

export const DEFAULT_MEDIA_PRESENTATION_STATE: MediaPresentationState = Object.freeze({
  fullscreen: 'none',
  pictureInPicture: false
})

export type VisualValidationErrorCode = 'INVALID_VISUAL_STATE'

export interface VisualValidationError {
  readonly code: VisualValidationErrorCode
  readonly issueCount: number
}

function freezeVisualState(value: z.infer<typeof visualStateSchema>): VisualState {
  return Object.freeze({
    zoom: value.zoom,
    pan: Object.freeze({ x: value.pan.x, y: value.pan.y }),
    rotation: value.rotation,
    flip: Object.freeze({
      horizontal: value.flip.horizontal,
      vertical: value.flip.vertical
    }),
    filters: Object.freeze({ ...value.filters })
  })
}

export function parseVisualState(
  value: unknown
):
  | { readonly ok: true; readonly value: VisualState }
  | { readonly ok: false; readonly error: VisualValidationError } {
  const parsed = visualStateSchema.safeParse(value)
  return parsed.success
    ? { ok: true, value: freezeVisualState(parsed.data) }
    : {
        ok: false,
        error: { code: 'INVALID_VISUAL_STATE', issueCount: parsed.error.issues.length }
      }
}

export function cloneVisualState(value: VisualState): VisualState {
  return freezeVisualState(visualStateSchema.parse(value))
}

export function visualStateEquals(left: VisualState, right: VisualState): boolean {
  return (
    left.zoom === right.zoom &&
    left.pan.x === right.pan.x &&
    left.pan.y === right.pan.y &&
    left.rotation === right.rotation &&
    left.flip.horizontal === right.flip.horizontal &&
    left.flip.vertical === right.flip.vertical &&
    left.filters.brightness === right.filters.brightness &&
    left.filters.contrast === right.filters.contrast &&
    left.filters.saturation === right.filters.saturation &&
    left.filters.hue === right.filters.hue &&
    left.filters.blur === right.filters.blur
  )
}

export function isDefaultVisualState(value: VisualState): boolean {
  return visualStateEquals(value, DEFAULT_VISUAL_STATE)
}

export function roundVisualValue(value: number, precision = 2): number {
  const factor = 10 ** precision
  return Math.round((Number.isFinite(value) ? value : 0) * factor) / factor
}

export function clampVisualZoom(value: number): number {
  return roundVisualValue(Math.min(VISUAL_LIMITS.maxZoom, Math.max(VISUAL_LIMITS.minZoom, value)))
}

export function clampVisualPan(value: number): number {
  return roundVisualValue(Math.min(VISUAL_LIMITS.maxPan, Math.max(-VISUAL_LIMITS.maxPan, value)))
}

export function normalizeRotation(value: number): number {
  const normalized = ((roundVisualValue(value) % 360) + 360) % 360
  return normalized === 360 ? 0 : normalized
}

export function clampVisualFilter(name: VisualFilterName, value: number): number {
  if (name === 'hue') return Math.min(360, Math.max(-360, roundVisualValue(value)))
  if (name === 'blur') return Math.min(VISUAL_LIMITS.maxBlur, Math.max(0, roundVisualValue(value)))
  return Math.min(VISUAL_LIMITS.maxFilterFactor, Math.max(0, roundVisualValue(value)))
}

export function setVisualZoom(state: VisualState, value: number): VisualState {
  return freezeVisualState(visualStateSchema.parse({ ...state, zoom: clampVisualZoom(value) }))
}

export function panVisual(state: VisualState, deltaX: number, deltaY: number): VisualState {
  return freezeVisualState(
    visualStateSchema.parse({
      ...state,
      pan: {
        x: clampVisualPan(state.pan.x + (Number.isFinite(deltaX) ? deltaX : 0)),
        y: clampVisualPan(state.pan.y + (Number.isFinite(deltaY) ? deltaY : 0))
      }
    })
  )
}

export function rotateVisual(state: VisualState, deltaDegrees: number): VisualState {
  return freezeVisualState(
    visualStateSchema.parse({
      ...state,
      rotation: normalizeRotation(state.rotation + deltaDegrees)
    })
  )
}

export function toggleVisualFlip(state: VisualState, axis: 'horizontal' | 'vertical'): VisualState {
  return freezeVisualState(
    visualStateSchema.parse({
      ...state,
      flip: { ...state.flip, [axis]: !state.flip[axis] }
    })
  )
}

export function resetVisualTransform(state: VisualState): VisualState {
  return freezeVisualState(
    visualStateSchema.parse({
      ...state,
      zoom: DEFAULT_VISUAL_STATE.zoom,
      pan: DEFAULT_VISUAL_STATE.pan,
      rotation: DEFAULT_VISUAL_STATE.rotation,
      flip: DEFAULT_VISUAL_STATE.flip
    })
  )
}

export function setVisualFilter(
  state: VisualState,
  name: VisualFilterName,
  value: number
): VisualState {
  return freezeVisualState(
    visualStateSchema.parse({
      ...state,
      filters: { ...state.filters, [name]: clampVisualFilter(name, value) }
    })
  )
}

/**
 * CSS is generated in the adapter boundary, but keeping these serializers in
 * the pure domain makes the exact rendering contract easy to unit test.
 */
export function serializeVisualTransform(state: VisualState): string {
  const flipX = state.flip.horizontal ? -1 : 1
  const flipY = state.flip.vertical ? -1 : 1
  return `scale(${state.zoom}) translate(${state.pan.x}px, ${state.pan.y}px) rotate(${state.rotation}deg) scaleX(${flipX}) scaleY(${flipY})`
}

export function serializeVisualFilter(state: VisualState): string {
  const { brightness, contrast, saturation, hue, blur } = state.filters
  return `brightness(${brightness}) contrast(${contrast}) saturate(${saturation}) hue-rotate(${hue}deg) blur(${blur}px)`
}
