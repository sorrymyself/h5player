import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environment: 'happy-dom',
    include: [
      'tests/unit/**/*.spec.ts',
      'tests/component/**/*.spec.ts',
      'tests/integration/**/*.spec.ts',
      'tests/security/**/*.spec.ts',
      'tests/compatibility/**/*.spec.ts'
    ],
    exclude: ['tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/infrastructure/browser/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80
      }
    }
  }
})
