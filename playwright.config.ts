import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.e2e.ts',
  workers: 1,
  fullyParallel: false,
  // Multi-step Windows desktop scenarios include startup, persistence, and restart.
  timeout: 120000,
  expect: { timeout: 12000 },
  reporter: 'list',
  outputDir: './test-results',
});
