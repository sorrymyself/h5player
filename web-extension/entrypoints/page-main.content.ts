import { startPageMainRuntime } from '../src/runtime/page-main/page-main-runtime'

export default defineContentScript({
  matches: [],
  registration: 'runtime',
  allFrames: true,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    startPageMainRuntime(window, document)
  }
})
