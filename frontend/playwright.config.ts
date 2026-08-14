import { defineConfig, devices } from '@playwright/test'

const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    ...devices['Desktop Edge'],
    baseURL: 'http://127.0.0.1:5173',
    headless: true,
    launchOptions: chromiumExecutablePath ? { executablePath: chromiumExecutablePath, args: ['--no-sandbox'] } : undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'corepack pnpm dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
