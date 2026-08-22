import type {
  MediaAdapter,
  MediaControllerContext,
  ObservableMediaController
} from '../../domain/adapter'
import { GenericMediaController } from './generic-media-controller'
import { nativeMediaBindings } from './native-media-bindings'
import type { ExperimentalMediaDownloadPort } from './experimental-media-download'

export class GenericAdapter implements MediaAdapter<HTMLMediaElement> {
  readonly id = 'generic'
  readonly priority = 0

  constructor(private readonly experimentalDownload?: ExperimentalMediaDownloadPort) {}

  supports(target: unknown): target is HTMLMediaElement {
    return nativeMediaBindings.isMediaElement(target)
  }

  createController(
    target: HTMLMediaElement,
    context: MediaControllerContext
  ): ObservableMediaController {
    if (!this.supports(target)) {
      throw new TypeError('GenericAdapter only supports HTML video and audio elements')
    }
    return new GenericMediaController(target, context, this.experimentalDownload)
  }
}

export const genericAdapter = new GenericAdapter()
