import type { MediaCommand } from '../../domain/command'
import type { MediaId } from '../../domain/media'
import {
  createHotkeyPlanningState,
  getHotkeyCommandDefinition,
  HotkeyInterpreter,
  planHotkeyCommand,
  type HotkeyPlanningState,
  type HotkeyEventInput,
  type HotkeyCommandId
} from '../../domain/hotkey'
import type { GlobalSettings } from '../../domain/settings'
import type { MediaCommandResultResponse, MediaPageState } from '../media'
import type { Teardown } from '../ports/browser'

export type HotkeyRuntimeEvent = HotkeyEventInput &
  Readonly<{
    editableTarget: boolean
    playerFocused: boolean
    trusted?: boolean
    preventDefault(): void
    stopPropagation(): void
  }>

export interface HotkeyEventSourcePort {
  subscribe(listener: (event: HotkeyRuntimeEvent) => void): Teardown
}

export interface HotkeyMediaPort {
  getState(): Promise<MediaPageState>
  peekState?(): MediaPageState | null
  execute(command: MediaCommand): Promise<MediaCommandResultResponse>
  toggleSiteRestoreProgress?(mediaId: MediaId): Promise<void>
  remote?: HotkeyRemoteMediaPort
}

export type HotkeyRemoteState = Readonly<{
  generation: number
  state: MediaPageState
}>

export interface HotkeyRemoteMediaPort {
  getState(): Promise<HotkeyRemoteState | null>
  peekState(): HotkeyRemoteState | null
  execute(command: MediaCommand, generation: number): Promise<MediaCommandResultResponse>
  supportsCommand(commandId: HotkeyCommandId): boolean
}

export class HotkeyController {
  private settings: GlobalSettings
  private unsubscribe: Teardown | null = null
  private executionTail: Promise<void> = Promise.resolve()
  private latestState: MediaPageState | null = null
  private planningState: HotkeyPlanningState = createHotkeyPlanningState()
  private remotePlanningState: HotkeyPlanningState = createHotkeyPlanningState()

  constructor(
    private readonly source: HotkeyEventSourcePort,
    private readonly media: HotkeyMediaPort,
    initialSettings: GlobalSettings,
    private readonly onError: (error: unknown) => void = () => undefined,
    private readonly interpreter = new HotkeyInterpreter()
  ) {
    this.settings = initialSettings
  }

  start(initialState?: MediaPageState): Teardown {
    if (!this.unsubscribe) {
      if (initialState !== undefined) this.latestState = initialState
      this.unsubscribe = this.source.subscribe(this.handleEvent)
      if (initialState === undefined) void this.refreshState()
    }
    return () => this.stop()
  }

  update(settings: GlobalSettings): void {
    this.settings = settings
  }

  refresh(): void {
    void this.refreshState()
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  private readonly handleEvent = (event: HotkeyRuntimeEvent): void => {
    const decision = this.interpreter.decide(event, {
      enabled: this.settings.enabled && this.settings.hotkeys.enabled,
      scope: this.settings.hotkeys.scope,
      bindings: this.settings.hotkeys.bindings,
      editableTarget: event.editableTarget,
      playerFocused: event.playerFocused
    })
    if (!decision.matched) return

    const definition = getHotkeyCommandDefinition(decision.binding.commandId)
    if (definition.id === 'media.download' && event.trusted === false) return
    const currentState = this.media.peekState ? this.media.peekState() : this.latestState
    const localSnapshot =
      currentState?.media.find((item) => item.id === currentState.activeMediaId) ?? null
    const remote = localSnapshot === null ? (this.media.remote?.peekState() ?? null) : null
    const remoteSnapshot =
      remote?.state.media.find((item) => item.id === remote.state.activeMediaId) ?? null
    const useRemote =
      localSnapshot === null &&
      remoteSnapshot !== null &&
      definition.action === 'media' &&
      this.media.remote?.supportsCommand(definition.id) === true &&
      !reservedRemoteShortcut(event)
    const currentSnapshot = useRemote ? remoteSnapshot : localSnapshot
    if (
      currentSnapshot === null ||
      definition.supportsSnapshot?.(currentSnapshot) === false ||
      (definition.action === 'toggle-site-progress-restore' &&
        this.media.toggleSiteRestoreProgress === undefined)
    ) {
      if (currentSnapshot === null && remoteSnapshot === null) {
        // A cross-origin player frame can become routable after the top-frame
        // shortcut cache was primed. Resolve and execute this first shortcut
        // asynchronously instead of requiring the user to press it twice.
        this.enqueueLocalExecution(decision.binding.commandId)
      } else {
        void this.refreshState()
      }
      return
    }

    event.preventDefault()
    event.stopPropagation()
    this.executionTail = this.executionTail
      .then(async () => {
        if (useRemote) {
          const remoteState = await this.media.remote?.getState()
          if (remoteState === null || remoteState === undefined) return
          const snapshot = remoteState.state.media.find(
            (item) => item.id === remoteState.state.activeMediaId
          )
          if (!snapshot || definition.supportsSnapshot?.(snapshot) === false) return
          const plan = planHotkeyCommand({
            commandId: decision.binding.commandId,
            snapshot,
            now: Date.now(),
            state: this.remotePlanningState
          })
          this.remotePlanningState = plan.state
          await this.media.remote?.execute(plan.command, remoteState.generation)
          return
        }
        await this.executeLocalCommand(decision.binding.commandId)
      })
      .catch((error: unknown) => this.onError(error))
  }

  private enqueueLocalExecution(commandId: HotkeyCommandId): void {
    this.executionTail = this.executionTail
      .then(() => this.executeLocalCommand(commandId))
      .catch((error: unknown) => this.onError(error))
  }

  private async executeLocalCommand(commandId: HotkeyCommandId): Promise<void> {
    const definition = getHotkeyCommandDefinition(commandId)
    const state = await this.media.getState()
    this.latestState = state
    if (!state.activeMediaId) return
    const snapshot = state.media.find((item) => item.id === state.activeMediaId)
    if (!snapshot || definition.supportsSnapshot?.(snapshot) === false) return
    if (definition.action === 'toggle-site-progress-restore') {
      await this.media.toggleSiteRestoreProgress?.(snapshot.id)
      return
    }
    if (definition.action !== 'media') return
    const plan = planHotkeyCommand({
      commandId,
      snapshot,
      now: Date.now(),
      state: this.planningState
    })
    this.planningState = plan.state
    const response = await this.media.execute(plan.command)
    this.latestState = response.state
  }

  private async refreshState(): Promise<void> {
    try {
      this.latestState = await this.media.getState()
    } catch {
      // Frame replacement is expected; the next state notification will recover the cache.
    }
    try {
      await this.media.remote?.getState()
    } catch {
      // A missing or expired PiP owner must not affect local shortcut handling.
    }
  }
}

function reservedRemoteShortcut(event: HotkeyRuntimeEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    (event.code === 'KeyC' ||
      event.code === 'KeyV' ||
      event.code === 'KeyF' ||
      event.code === 'KeyD')
  )
}
