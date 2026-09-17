/** Capture screenshots of the major UI states into docs/screenshots/.
 *  Boots a fixture-mode server on a temp data dir; no credits spent. */
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';

const root=fileURLToPath(new URL('..',import.meta.url));
const dataDir=mkdtempSync(join(tmpdir(),'jevmusic-shots-'));
const PORT=4399;
const outDir=join(root,'..','docs','screenshots');

const srv=spawn('npx',['tsx','server/index.ts'],{cwd:root,
  env:{...process.env,JEV_PROVIDER:'fixture',FIXTURE_DELAY_MS:'60',DATA_DIR:dataDir,PORT:String(PORT),HOST:'127.0.0.1'},
  stdio:'ignore'});
await new Promise(r=>setTimeout(r,3000));

const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1280,height:800}});
try{
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForSelector('.card');
  await page.screenshot({path:join(outDir,'01-prompt.png')});

  // create + pause a job via the API so the progress screen is stable to capture
  const job0=await (await fetch(`http://127.0.0.1:${PORT}/api/compose`,{method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({prompt:'gentle lo-fi waltz, 16 bars',commandId:'shots-compose'})})).json();
  await fetch(`http://127.0.0.1:${PORT}/api/jobs/${job0.jobId}/pause`,{method:'POST'}).catch(()=>{});
  await page.reload();
  await page.locator('.listitem').first().click();
  await page.waitForSelector('h1:has-text("Composing")',{timeout:15000});
  await page.waitForTimeout(600);
  await page.screenshot({path:join(outDir,'02-generating.png')});
  await fetch(`http://127.0.0.1:${PORT}/api/jobs/${job0.jobId}/resume`,{method:'POST'}).catch(()=>{});

  await page.getByRole('button',{name:'Export MIDI'}).waitFor({timeout:120_000});
  await page.waitForTimeout(500);
  await page.screenshot({path:join(outDir,'03-studio.png'),fullPage:false});

  console.log('screenshots written to',outDir);
}finally{
  await browser.close();
  srv.kill('SIGTERM');
}
