import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          globals: true,
          environment: 'happy-dom',
          setupFiles: ['./tests/setup.unit.ts'],
          include: ['src/**/*.test.{ts,tsx}', 'workers/**/*.test.ts'],
          css: false,
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          globals: true,
          environment: 'node',
          globalSetup: ['./tests/global-setup.integration.ts'],
          setupFiles: ['./tests/setup.integration.ts'],
          include: ['tests/integration/**/*.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 30_000,
          fileParallelism: false,
        },
      },
    ],
  },
})
