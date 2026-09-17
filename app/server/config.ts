/** Server configuration: env + .env file + stored settings. Secrets never leave the server. */
import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

export const APP_ROOT = fileURLToPath(new URL('..', import.meta.url));

function loadDotEnv(path:string):Record<string,string> {
  if(!existsSync(path)) return {};
  const out:Record<string,string>={};
  for(const line of readFileSync(path,'utf8').split('\n')){
    const m=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if(m) out[m[1]]=m[2].replace(/^["']|["']$/g,'');
  }
  return out;
}

export interface AppConfig {
  host:string; port:number; appOrigin:string; dataDir:string;
  model:string; providerMode:'live'|'fixture';
  maxJobAttempts:number; maxProviderBodyBytes:number;
  providerAttemptTimeoutMs:number; providerMaxAttemptsPerDecision:number;
  liveJev:boolean; version:string;
}

const env = {...loadDotEnv(join(APP_ROOT,'.env')), ...process.env};

export function loadConfig():AppConfig {
  const dataDir = env.DATA_DIR || join(APP_ROOT,'data');
  return {
    host: env.HOST || '127.0.0.1',
    port: parseInt(env.PORT || '4318',10),
    appOrigin: env.APP_ORIGIN || '',
    dataDir,
    model: env.JEV_MODEL || 'jev-latest',
    providerMode: env.JEV_PROVIDER==='fixture' ? 'fixture' : 'live',
    maxJobAttempts: parseInt(env.MAX_JOB_ATTEMPTS || '12000',10),
    maxProviderBodyBytes: parseInt(env.MAX_PROVIDER_BODY_BYTES || '2097152',10),
    providerAttemptTimeoutMs: parseInt(env.PROVIDER_ATTEMPT_TIMEOUT_MS || '45000',10),
    providerMaxAttemptsPerDecision: parseInt(env.PROVIDER_MAX_ATTEMPTS_PER_DECISION || '4',10),
    liveJev: env.LIVE_JEV==='1',
    version: '0.1.0'
  };
}

/** Stored operator settings (API key etc.) — lives in data/, never exported. */
interface StoredConfig { apiKey?:string; providerMode?:'live'|'fixture' }
function settingsPath(cfg:AppConfig){ return join(cfg.dataDir,'settings.json'); }
export function readStored(cfg:AppConfig):StoredConfig {
  try { return JSON.parse(readFileSync(settingsPath(cfg),'utf8')); } catch { return {}; }
}
export function writeStored(cfg:AppConfig, patch:StoredConfig):void {
  mkdirSync(cfg.dataDir,{recursive:true});
  writeFileSync(settingsPath(cfg), JSON.stringify({...readStored(cfg),...patch},null,2), {mode:0o600});
}
export function effectiveKey(cfg:AppConfig):string|undefined {
  return env.TYPESAFE_API_KEY || readStored(cfg).apiKey || undefined;
}
export const hasEnvKey = () => !!env.TYPESAFE_API_KEY;
/** Env JEV_PROVIDER wins; otherwise the operator's stored choice; default live. */
export function effectiveMode(cfg:AppConfig):'live'|'fixture' {
  if(env.JEV_PROVIDER==='fixture')return 'fixture';
  if(env.JEV_PROVIDER==='live')return 'live';
  return readStored(cfg).providerMode ?? cfg.providerMode;
}
