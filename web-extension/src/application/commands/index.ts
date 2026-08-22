import { CommandRegistry } from '../../domain/command'
import type { MediaControllerResolver } from '../../domain/media'
import {
  MEDIA_COMMAND_HANDLERS,
  adjustRateCommandHandler,
  adjustVolumeCommandHandler,
  adjustGainCommandHandler,
  captureCommandHandler,
  panCommandHandler,
  pauseCommandHandler,
  playNextCommandHandler,
  playCommandHandler,
  resetTransformCommandHandler,
  resetVisualCommandHandler,
  rotateCommandHandler,
  seekCommandHandler,
  setFilterCommandHandler,
  setMutedCommandHandler,
  setRateCommandHandler,
  setVolumeCommandHandler,
  setGainCommandHandler,
  setZoomCommandHandler,
  stepFrameCommandHandler,
  toggleFlipCommandHandler,
  toggleFullscreenCommandHandler,
  toggleMuteCommandHandler,
  togglePictureInPictureCommandHandler
} from './media-command-handlers'

export {
  MEDIA_COMMAND_HANDLERS,
  adjustRateCommandHandler,
  adjustVolumeCommandHandler,
  adjustGainCommandHandler,
  captureCommandHandler,
  panCommandHandler,
  pauseCommandHandler,
  playNextCommandHandler,
  playCommandHandler,
  resetTransformCommandHandler,
  resetVisualCommandHandler,
  rotateCommandHandler,
  seekCommandHandler,
  setFilterCommandHandler,
  setMutedCommandHandler,
  setRateCommandHandler,
  setVolumeCommandHandler,
  setGainCommandHandler,
  setZoomCommandHandler,
  stepFrameCommandHandler,
  toggleFlipCommandHandler,
  toggleFullscreenCommandHandler,
  toggleMuteCommandHandler,
  togglePictureInPictureCommandHandler
}

export function createMediaCommandRegistry(controllers: MediaControllerResolver): CommandRegistry {
  return new CommandRegistry(controllers, MEDIA_COMMAND_HANDLERS)
}
