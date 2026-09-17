/** Express entrypoint: API + static web build + provider wiring. */
import express from 'express';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {loadConfig, effectiveMode, effectiveKey} from './config.js';
import type {AppConfig} from './config.js';
import {openDb} from './db.js';
import {EventBus} from './events.js';
import {JobRunner} from './jobs.js';
import {buildRouter} from './routes.js';
import {LiveProvider} from './provider.js';
import {FixtureProvider} from './fixture.js';
import type {DecisionProvider} from '../core/types.js';

export function createServer(overrides:Partial<AppConfig>={}) {
  const cfg:AppConfig={...loadConfig(),...overrides};
  const db=openDb(cfg);
  const bus=new EventBus(db);
  const fixture=new FixtureProvider();
  const providerFor=():DecisionProvider|null=>{
    if(effectiveMode(cfg)==='fixture')return fixture;
    const key=effectiveKey(cfg);
    return key?new LiveProvider(cfg,key):null;
  };
  const runner=new JobRunner(db,cfg,providerFor,bus);
  runner.recover();

  const app=express();
  app.disable('x-powered-by');
  app.use(express.json({limit:'1mb'}));
  app.use(buildRouter(db,cfg,runner,bus,providerFor));

  const webDist=join(fileURLToPath(new URL('..',import.meta.url)),'web','dist');
  if(existsSync(webDist)){
    app.use(express.static(webDist,{index:false,maxAge:'1h'}));
    app.get(/^(?!\/api\/).*/,(_req,res)=>res.sendFile(join(webDist,'index.html')));
  } else {
    app.get('/',(_req,res)=>res.send('Jevthoven API up — web build missing. Run `npm run build` or `npm run dev` (Vite).'));
  }
  app.use((_req,res)=>res.status(404).json({code:'not_found',message:'Unknown route',retryable:false}));
  return {app,cfg,db,runner,bus};
}

const isMain=process.argv[1]&&import.meta.url.endsWith(process.argv[1].replace(/\\/g,'/').split('/').pop()!)
  &&process.argv[1].includes('server');
if(isMain||process.env.JEV_SERVE==='1'){
  const {app,cfg}=createServer();
  app.listen(cfg.port,cfg.host,()=>{
    console.log(`Jevthoven listening at http://${cfg.host}:${cfg.port}/  (mode: ${effectiveMode(cfg)}, key: ${effectiveKey(cfg)?'set':'missing'})`);
  });
}
