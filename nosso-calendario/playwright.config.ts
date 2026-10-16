import { defineConfig, devices } from '@playwright/test';

const FAKE = 'http://127.0.0.1:4100';
const PORT = 4174;

// iPhone 14 (viewport, toque, user agent do Safari iOS). O projeto usa
// Chromium porque o WebKit do Playwright não está instalado neste ambiente;
// com WebKit disponível, rode também o projeto "iphone-webkit".
const iphone = { ...devices['iPhone 14'], locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' };

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    serviceWorkers: 'allow',
  },
  projects: [
    { name: 'iphone-chromium', use: { ...iphone, browserName: 'chromium', defaultBrowserType: 'chromium' } },
    ...(process.env.PW_WEBKIT ? [{ name: 'iphone-webkit', use: { ...iphone, browserName: 'webkit' as const } }] : []),
  ],
  webServer: [
    {
      command: 'node tests/support/fake-google.mjs 4100',
      url: `${FAKE}/__test/dump`,
      reuseExistingServer: false,
      env: { FAKE_EMAIL: 'eduardo@example.com' },
    },
    {
      command: `npm run build --silent && node scripts/dev-server.mjs ${PORT}`,
      url: `http://localhost:${PORT}/`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NC_E2E: '1',
        GOOGLE_CLIENT_ID: 'test-client',
        GOOGLE_CLIENT_SECRET: 'test-secret',
        ALLOWED_USERS: 'eduardo:eduardo@example.com,esposa:esposa@example.com',
        FAMILY_CALENDAR_NAME: 'Família Spohr',
        BUSY_SOURCES: 'eduardo:trabalho@example.com',
        GOOGLE_OAUTH_AUTHORIZE_URL: `${FAKE}/o/oauth2/v2/auth`,
        GOOGLE_OAUTH_TOKEN_URL: `${FAKE}/token`,
        GOOGLE_CALENDAR_API_BASE: `${FAKE}/calendar/v3`,
      },
    },
  ],
});
