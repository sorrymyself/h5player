export default defineContentScript({
  matches: [],
  registration: 'runtime',
  allFrames: true,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    // The experimental manager is owned by page-main. This entrypoint remains
    // as a stable dynamic-injection target for older registered scripts.
  }
})
