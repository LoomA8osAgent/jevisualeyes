import {defineConfig} from '@playwright/test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const dataDir=mkdtempSync(join(tmpdir(),'jevmusic-e2e-'));
const PORT=4380;

export default defineConfig({
  testDir:'./e2e',
  timeout:120_000,
  use:{baseURL:`http://127.0.0.1:${PORT}`},
  webServer:{
    command:`npx tsx server/index.ts`,
    url:`http://127.0.0.1:${PORT}/api/health`,
    env:{JEV_PROVIDER:'fixture',DATA_DIR:dataDir,PORT:String(PORT),HOST:'127.0.0.1'},
    reuseExistingServer:!process.env.CI,
    timeout:30_000,
  },
});
