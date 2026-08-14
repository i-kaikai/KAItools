import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  projects: [
    {
      name: 'web',
      use: {
        ...devices['Desktop Edge'],
        channel: 'msedge',
        baseURL: 'http://127.0.0.1:4173',
        headless: true,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
      },
    },
  ],
  webServer: {
    command: 'pnpm build:web && pnpm preview:web',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      ...process.env,
      VITE_ICP_NUMBER: '京ICP备00000000号-1',
    },
  },
})
