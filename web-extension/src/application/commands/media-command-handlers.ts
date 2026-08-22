import {
  clampMediaTime,
  clampPlaybackRate,
  clampAudioGain,
  clampUnit,
  DEFAULT_VISUAL_STATE,
  panVisual,
  resetVisualTransform,
  rotateVisual,
  roundMediaValue,
  setVisualFilter,
  setVisualZoom,
  toggleVisualFlip,
  visualStateEquals,
  type VisualState
} from '../../domain/media'
import {
  commandFailure,
  commandSuccess,
  errorName,
  type AdjustRateCommand,
  type AdjustVolumeCommand,
  type AdjustGainCommand,
  type CommandHandler,
  type MediaCommand,
  type PauseCommand,
  type PlayNextCommand,
  type PlayCommand,
  type ResetTransformCommand,
  type ResolvedCommandContext,
  type SeekCommand,
  type StepFrameCommand,
  type SetMutedCommand,
  type SetRateCommand,
  type SetVolumeCommand,
  type SetGainCommand,
  type ToggleMuteCommand
} from '../../domain/command'

import { isCaptureFailure } from '../../domain/capture'
import type {
  CaptureCommand,
  PanCommand,
  ResetVisualCommand,
  RotateCommand,
  SetFilterCommand,
  SetZoomCommand,
  ToggleFlipCommand,
  ToggleFullscreenCommand,
  TogglePictureInPictureCommand
} from '../../domain/command'
import type { DownloadCommand } from '../../domain/command'

const LEGACY_FRAME_RATE = 30

function changedResult(command: MediaCommand, context: ResolvedCommandContext) {
  return commandSuccess(command, context.controller.getSnapshot(), true)
}

function verifiedPlaybackRateResult(
  command: SetRateCommand | AdjustRateCommand,
  context: ResolvedCommandContext,
  target: number
) {
  const snapshot = context.controller.getSnapshot()
  if (!mediaValuesEqual(snapshot.metrics.playbackRate, target)) {
    return commandFailure('COMMAND_EXECUTION_FAILED', {
      commandType: command.type,
      mediaId: context.snapshot.id,
      phase: 'playback-rate-postcondition',
      expectedRate: target,
      actualRate: snapshot.metrics.playbackRate
    })
  }
  return commandSuccess(command, snapshot, true)
}

function mediaValuesEqual(left: number, right: number): boolean {
  return roundMediaValue(left) === roundMediaValue(right)
}

function visualStateFromSnapshot(snapshot: ResolvedCommandContext['snapshot']): VisualState {
  return snapshot.visual ?? DEFAULT_VISUAL_STATE
}

function visualOperationFailure(
  command: MediaCommand,
  context: ResolvedCommandContext,
  phase: string,
  error?: unknown
) {
  return commandFailure('COMMAND_EXECUTION_FAILED', {
    commandType: command.type,
    mediaId: context.snapshot.id,
    phase,
    cause: error === undefined ? 'ControllerOperationUnavailable' : errorName(error)
  })
}

async function applyVisualState(
  command: MediaCommand,
  context: ResolvedCommandContext,
  target: VisualState
) {
  const current = visualStateFromSnapshot(context.snapshot)
  if (visualStateEquals(current, target)) {
    return commandSuccess(command, context.snapshot, false)
  }
  if (context.controller.setVisualState === undefined) {
    return visualOperationFailure(command, context, 'visual-port')
  }
  try {
    await context.controller.setVisualState(target)
  } catch (error) {
    return visualOperationFailure(command, context, 'visual', error)
  }
  return changedResult(command, context)
}

function legacySeekTarget(
  currentTime: number,
  deltaSeconds: number,
  duration: number | null
): number {
  const relative = currentTime + deltaSeconds
  const legacyAdjusted = deltaSeconds < 0 && relative < 1 ? 0 : relative
  return clampMediaTime(roundMediaValue(legacyAdjusted, 1), duration)
}

async function applyVolume(
  command: SetVolumeCommand | AdjustVolumeCommand,
  context: ResolvedCommandContext,
  target: number
) {
  const volumeChanged = !mediaValuesEqual(target, context.snapshot.metrics.volume)
  const shouldUnmute = context.snapshot.metrics.muted && context.snapshot.capabilities.mute
  if (!volumeChanged && !shouldUnmute) {
    return commandSuccess(command, context.snapshot, false)
  }
  if (volumeChanged) await context.controller.setVolume(target)
  if (shouldUnmute) await context.controller.setMuted(false)
  return changedResult(command, context)
}

export const playCommandHandler: CommandHandler<PlayCommand> = {
  type: 'media.play',
  requiredCapability: 'playback',
  async execute(command, context) {
    if (context.snapshot.state === 'active') {
      return commandSuccess(command, context.snapshot, false)
    }
    await context.controller.play()
    return changedResult(command, context)
  }
}

export const pauseCommandHandler: CommandHandler<PauseCommand> = {
  type: 'media.pause',
  requiredCapability: 'playback',
  async execute(command, context) {
    if (context.snapshot.state === 'paused') {
      return commandSuccess(command, context.snapshot, false)
    }
    await context.controller.pause()
    return changedResult(command, context)
  }
}

export const seekCommandHandler: CommandHandler<SeekCommand> = {
  type: 'media.seek',
  requiredCapability: 'seek',
  async execute(command, context) {
    if (command.deltaSeconds === 0) {
      return commandSuccess(command, context.snapshot, false)
    }
    const target = legacySeekTarget(
      context.snapshot.metrics.currentTime,
      command.deltaSeconds,
      context.snapshot.metrics.duration
    )
    if (mediaValuesEqual(target, context.snapshot.metrics.currentTime)) {
      return commandSuccess(command, context.snapshot, false)
    }
    await context.controller.seekTo(target)
    return changedResult(command, context)
  }
}

export const stepFrameCommandHandler: CommandHandler<StepFrameCommand> = {
  type: 'media.step-frame',
  requiredCapability: 'seek',
  async execute(command, context) {
    if (command.frames === 0) return commandSuccess(command, context.snapshot, false)
    if (!context.snapshot.capabilities.playback) {
      return commandFailure('CAPABILITY_UNAVAILABLE', {
        mediaId: context.snapshot.id,
        capability: 'playback'
      })
    }
    const target = clampMediaTime(
      context.snapshot.metrics.currentTime + command.frames / LEGACY_FRAME_RATE,
      context.snapshot.metrics.duration
    )
    const shouldPause = context.snapshot.state === 'active'
    const shouldSeek = !mediaValuesEqual(target, context.snapshot.metrics.currentTime)
    if (!shouldPause && !shouldSeek) return commandSuccess(command, context.snapshot, false)
    if (shouldPause) await context.controller.pause()
    if (shouldSeek) await context.controller.seekTo(target)
    return changedResult(command, context)
  }
}

export const setRateCommandHandler: CommandHandler<SetRateCommand> = {
  type: 'media.set-rate',
  requiredCapability: 'playbackRate',
  async execute(command, context) {
    const target = roundMediaValue(clampPlaybackRate(command.value), 1)
    if (mediaValuesEqual(target, context.snapshot.metrics.playbackRate)) {
      return commandSuccess(command, context.snapshot, false)
    }
    await context.controller.setPlaybackRate(target)
    return verifiedPlaybackRateResult(command, context, target)
  }
}

export const adjustRateCommandHandler: CommandHandler<AdjustRateCommand> = {
  type: 'media.adjust-rate',
  requiredCapability: 'playbackRate',
  async execute(command, context) {
    if (command.delta === 0) {
      return commandSuccess(command, context.snapshot, false)
    }
    const target = roundMediaValue(
      clampPlaybackRate(context.snapshot.metrics.playbackRate + command.delta),
      1
    )
    if (mediaValuesEqual(target, context.snapshot.metrics.playbackRate)) {
      return commandSuccess(command, context.snapshot, false)
    }
    await context.controller.setPlaybackRate(target)
    return verifiedPlaybackRateResult(command, context, target)
  }
}

export const setVolumeCommandHandler: CommandHandler<SetVolumeCommand> = {
  type: 'media.set-volume',
  requiredCapability: 'volume',
  async execute(command, context) {
    const target = roundMediaValue(clampUnit(command.value), 2)
    return applyVolume(command, context, target)
  }
}

export const adjustVolumeCommandHandler: CommandHandler<AdjustVolumeCommand> = {
  type: 'media.adjust-volume',
  requiredCapability: 'volume',
  async execute(command, context) {
    if (command.delta === 0) {
      return commandSuccess(command, context.snapshot, false)
    }
    const target = roundMediaValue(clampUnit(context.snapshot.metrics.volume + command.delta), 2)
    return applyVolume(command, context, target)
  }
}

export const setGainCommandHandler: CommandHandler<SetGainCommand> = {
  type: 'media.set-gain',
  requiredCapability: 'audioGain',
  async execute(command, context) {
    const target = roundMediaValue(clampAudioGain(command.value), 2)
    const current = context.snapshot.metrics.gain ?? 1
    if (mediaValuesEqual(target, current)) {
      return commandSuccess(command, context.snapshot, false)
    }
    if (context.controller.setGain === undefined) {
      return commandFailure('CAPABILITY_UNAVAILABLE', {
        mediaId: context.snapshot.id,
        capability: 'audioGain'
      })
    }
    await context.controller.setGain(target)
    return changedResult(command, context)
  }
}

export const adjustGainCommandHandler: CommandHandler<AdjustGainCommand> = {
  type: 'media.adjust-gain',
  requiredCapability: 'audioGain',
  async execute(command, context) {
    if (command.delta === 0) return commandSuccess(command, context.snapshot, false)
    const current = context.snapshot.metrics.gain ?? 1
    const target = roundMediaValue(clampAudioGain(current + command.delta), 2)
    if (mediaValuesEqual(target, current)) {
      return commandSuccess(command, context.snapshot, false)
    }
    if (context.controller.setGain === undefined) {
      return commandFailure('CAPABILITY_UNAVAILABLE', {
        mediaId: context.snapshot.id,
        capability: 'audioGain'
      })
    }
    await context.controller.setGain(target)
    return changedResult(command, context)
  }
}

export const setMutedCommandHandler: CommandHandler<SetMutedCommand> = {
  type: 'media.set-muted',
  requiredCapability: 'mute',
  async execute(command, context) {
    if (command.value === context.snapshot.metrics.muted) {
      return commandSuccess(command, context.snapshot, false)
    }
    await context.controller.setMuted(command.value)
    return changedResult(command, context)
  }
}

export const toggleMuteCommandHandler: CommandHandler<ToggleMuteCommand> = {
  type: 'media.toggle-mute',
  requiredCapability: 'mute',
  async execute(command, context) {
    await context.controller.setMuted(!context.snapshot.metrics.muted)
    return changedResult(command, context)
  }
}

export const setZoomCommandHandler: CommandHandler<SetZoomCommand> = {
  type: 'media.set-zoom',
  requiredCapability: 'visual',
  async execute(command, context) {
    return applyVisualState(
      command,
      context,
      setVisualZoom(visualStateFromSnapshot(context.snapshot), command.value)
    )
  }
}

export const panCommandHandler: CommandHandler<PanCommand> = {
  type: 'media.pan',
  requiredCapability: 'visual',
  async execute(command, context) {
    return applyVisualState(
      command,
      context,
      panVisual(visualStateFromSnapshot(context.snapshot), command.deltaX, command.deltaY)
    )
  }
}

export const rotateCommandHandler: CommandHandler<RotateCommand> = {
  type: 'media.rotate',
  requiredCapability: 'visual',
  async execute(command, context) {
    return applyVisualState(
      command,
      context,
      rotateVisual(visualStateFromSnapshot(context.snapshot), command.deltaDegrees)
    )
  }
}

export const toggleFlipCommandHandler: CommandHandler<ToggleFlipCommand> = {
  type: 'media.toggle-flip',
  requiredCapability: 'visual',
  async execute(command, context) {
    return applyVisualState(
      command,
      context,
      toggleVisualFlip(visualStateFromSnapshot(context.snapshot), command.axis)
    )
  }
}

export const setFilterCommandHandler: CommandHandler<SetFilterCommand> = {
  type: 'media.set-filter',
  requiredCapability: 'visual',
  async execute(command, context) {
    return applyVisualState(
      command,
      context,
      setVisualFilter(visualStateFromSnapshot(context.snapshot), command.filter, command.value)
    )
  }
}

export const resetVisualCommandHandler: CommandHandler<ResetVisualCommand> = {
  type: 'media.reset-visual',
  requiredCapability: 'visual',
  async execute(command, context) {
    // A single controller call is intentional: reset must not expose a
    // partially-reset transform/filter state to observers.
    return applyVisualState(command, context, DEFAULT_VISUAL_STATE)
  }
}

export const resetTransformCommandHandler: CommandHandler<ResetTransformCommand> = {
  type: 'media.reset-transform',
  requiredCapability: 'visual',
  async execute(command, context) {
    return applyVisualState(
      command,
      context,
      resetVisualTransform(visualStateFromSnapshot(context.snapshot))
    )
  }
}

function hasFullscreenModeCapability(
  context: ResolvedCommandContext,
  mode: ToggleFullscreenCommand['mode']
): boolean {
  const scoped =
    mode === 'native'
      ? context.snapshot.capabilities.fullscreenNative
      : context.snapshot.capabilities.fullscreenWeb
  return scoped ?? context.snapshot.capabilities.fullscreen
}

export const toggleFullscreenCommandHandler: CommandHandler<ToggleFullscreenCommand> = {
  type: 'media.toggle-fullscreen',
  async execute(command, context) {
    if (!hasFullscreenModeCapability(context, command.mode)) {
      return commandFailure('CAPABILITY_UNAVAILABLE', {
        mediaId: context.snapshot.id,
        capability: command.mode === 'native' ? 'fullscreenNative' : 'fullscreenWeb',
        mode: command.mode
      })
    }
    if (context.controller.toggleFullscreen === undefined) {
      return visualOperationFailure(command, context, 'fullscreen-port')
    }
    try {
      await context.controller.toggleFullscreen(command.mode)
    } catch (error) {
      return commandFailure('COMMAND_EXECUTION_FAILED', {
        commandType: command.type,
        mediaId: context.snapshot.id,
        phase: 'fullscreen',
        mode: command.mode,
        cause: errorName(error)
      })
    }
    return changedResult(command, context)
  }
}

export const togglePictureInPictureCommandHandler: CommandHandler<TogglePictureInPictureCommand> = {
  type: 'media.toggle-picture-in-picture',
  requiredCapability: 'pictureInPicture',
  async execute(command, context) {
    if (context.controller.togglePictureInPicture === undefined) {
      return visualOperationFailure(command, context, 'picture-in-picture-port')
    }
    try {
      await context.controller.togglePictureInPicture()
    } catch (error) {
      return commandFailure('COMMAND_EXECUTION_FAILED', {
        commandType: command.type,
        mediaId: context.snapshot.id,
        phase: 'picture-in-picture',
        cause: errorName(error)
      })
    }
    return changedResult(command, context)
  }
}

export const captureCommandHandler: CommandHandler<CaptureCommand> = {
  type: 'media.capture',
  requiredCapability: 'capture',
  async execute(command, context) {
    if (context.controller.captureFrame === undefined) {
      return commandFailure('CAPTURE_FAILED', {
        mediaId: context.snapshot.id,
        phase: 'capture-port'
      })
    }
    try {
      const artifact = await context.controller.captureFrame({
        mimeType: command.mimeType ?? 'image/png',
        ...(command.quality === undefined ? {} : { quality: command.quality })
      })
      return commandSuccess(command, context.controller.getSnapshot(), false, artifact)
    } catch (error) {
      return commandFailure(isCaptureFailure(error) ? error.code : 'CAPTURE_FAILED', {
        mediaId: context.snapshot.id,
        phase: 'capture'
      })
    }
  }
}

export const downloadCommandHandler: CommandHandler<DownloadCommand> = {
  type: 'media.download',
  requiredCapability: 'downloadExperimental',
  execute(command, context) {
    // A download has a browser-owned side effect and therefore cannot be
    // completed by the DOM-free command registry. Content runtime creates a
    // one-shot intent and routes preparation through the page bridge.
    return Promise.resolve(
      commandFailure('DOWNLOAD_UNAVAILABLE', {
        mediaId: context.snapshot.id,
        phase: 'download-route-required'
      })
    )
  }
}

export const playNextCommandHandler: CommandHandler<PlayNextCommand> = {
  type: 'media.play-next',
  requiredCapability: 'next',
  async execute(command, context) {
    if (context.controller.playNext === undefined) {
      return commandFailure('COMMAND_EXECUTION_FAILED', {
        commandType: command.type,
        mediaId: context.snapshot.id,
        phase: 'next-port'
      })
    }
    try {
      await context.controller.playNext()
    } catch (error) {
      return commandFailure('COMMAND_EXECUTION_FAILED', {
        commandType: command.type,
        mediaId: context.snapshot.id,
        phase: 'next',
        cause: errorName(error)
      })
    }
    return changedResult(command, context)
  }
}

export const MEDIA_COMMAND_HANDLERS: readonly CommandHandler[] = [
  playCommandHandler,
  pauseCommandHandler,
  seekCommandHandler,
  stepFrameCommandHandler,
  setRateCommandHandler,
  adjustRateCommandHandler,
  setVolumeCommandHandler,
  adjustVolumeCommandHandler,
  setGainCommandHandler,
  adjustGainCommandHandler,
  setMutedCommandHandler,
  toggleMuteCommandHandler,
  setZoomCommandHandler,
  panCommandHandler,
  rotateCommandHandler,
  toggleFlipCommandHandler,
  setFilterCommandHandler,
  resetVisualCommandHandler,
  resetTransformCommandHandler,
  toggleFullscreenCommandHandler,
  togglePictureInPictureCommandHandler,
  captureCommandHandler,
  downloadCommandHandler,
  playNextCommandHandler
]
