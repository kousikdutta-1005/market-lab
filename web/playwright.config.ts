import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: { baseURL: 'http://localhost:5177', screenshot: 'only-on-failure' },
  reporter: [['list']],
});
