import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const executablePath = ['/usr/lib/chromium/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  .find(path => existsSync(path));

export default defineConfig({
  testDir: '.',
  testMatch: 'evidence.spec.mjs',
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: 'line',
  outputDir: 'node_modules/.cache/browser-evidence/test-results',
  use: {
    browserName: 'chromium',
    headless: true,
    serviceWorkers: 'block',
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      // The browser receives no shell environment, project key or credentials.
      env: {},
      args: [
        '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
        '--disable-component-update', '--disable-sync', '--no-first-run',
        // The SDK drops navigator.webdriver clients before before_send. This
        // loopback-only fixture measures its normal-visitor capture path.
        '--disable-blink-features=AutomationControlled',
        '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>',
      ],
    },
  },
});
