module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true }
    },
    {
      name: 'domain-no-runtime-dependencies',
      severity: 'error',
      from: { path: '^src/domain' },
      to: { path: '^(src/(infrastructure|runtime|ui)|entrypoints)' }
    },
    {
      name: 'domain-no-framework-dependencies',
      severity: 'error',
      from: { path: '^src/domain' },
      to: { path: '(^|/)(vue|wxt)(/|$)' }
    },
    {
      name: 'application-no-infrastructure-or-runtime',
      severity: 'error',
      from: { path: '^src/application' },
      to: { path: '^src/(infrastructure|runtime|ui)' }
    },
    {
      name: 'ui-no-browser-or-infrastructure',
      severity: 'error',
      from: { path: '^src/ui' },
      to: { path: '(^|/)(wxt|chrome|browser)(/|$)|^src/(infrastructure|runtime)' }
    },
    {
      name: 'no-legacy-runtime-imports',
      severity: 'error',
      from: { path: '^(src|entrypoints)' },
      to: { path: '(^|/)(inject(?:\\.base|\\.main)?\\.js|src/h5player|src/libs)(/|$)' }
    }
  ],
  options: {
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.vue', '.js', '.mjs']
    },
    reporterOptions: {
      dot: { collapsePattern: 'node_modules/[^/]+' }
    }
  }
}
