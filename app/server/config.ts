/** Runner configuration: env + a `.env` file + a 0600 stored-settings file.
 *  Secrets never leave this process and are never written to the repo.
 *
 *  THE DEFAULT POSTURE INVERTS from upstream (`roadmap/jevisualeyes-rework.md` §3): the
 *  default provider is `local` — the reference runtime served over the Jev wire on
 *  loopback (`specs/ai/jev.md` §9.4) — not the remote endpoint. `jev` is opt-in and
 *  needs the operator's own key from the environment, never a repo file.
 */
import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import type {ProviderClass} from '../core/types.js';

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

export type ProviderId = 'local'|'jev'|'fixture';

export interface AppConfig {
  dataDir:string;
  providerId:ProviderId;
  /** `local`: the reference runtime, `von serve --host 127.0.0.1 --port 8493` (§9.4). */
  localBaseUrl:string; localModel:string; localClass:ProviderClass;
  /** `jev`: the upstream endpoint (§1.1). Opt-in, key from the environment only. */
  jevBaseUrl:string; jevModel:string;
  /** `fixture`: a path to the planted answer map (§9). A missing map is an error. */
  fixturePath:string;
  maxJobAttempts:number; maxProviderBodyBytes:number;
  providerAttemptTimeoutMs:number; providerMaxAttemptsPerDecision:number;
  /** One explicitly authorized live call; never set during a test or a gate (§3). */
  liveJev:boolean;
  version:string;
}

const env = {...loadDotEnv(join(APP_ROOT,'.env')), ...process.env};

const providerFromEnv = (v:string|undefined):ProviderId|null =>
  v==='local'||v==='jev'||v==='fixture' ? v : null;

export function loadConfig():AppConfig {
  return {
    dataDir: env.DATA_DIR || join(APP_ROOT,'data'),
    providerId: providerFromEnv(env.JEV_PROVIDER) ?? 'local',
    // ⚠ loopback is explicit and binding: `von serve` defaults to 0.0.0.0, which is a
    // LAN-exposed decision server with no auth (§9.4a). A8os only ever speaks to
    // 127.0.0.1, and the launcher passes --host 127.0.0.1 (§Privacy — loopback only).
    localBaseUrl: env.JEV_LOCAL_URL || 'http://127.0.0.1:8493',
    localModel: env.JEV_LOCAL_MODEL || 'von-latest',
    // §3.1a — only a TRAINED provider's NUMBER is a calibrated confidence. The reference
    // runtime is TRAINED; a DECODE server put behind this URL must SAY so, because the
    // receipt records the class and an artifact must never read as calibrated when it
    // is not.
    localClass: (env.JEV_LOCAL_CLASS as ProviderClass) || 'TRAINED',
    jevBaseUrl: env.JEV_API_URL || 'https://api.typesafe.ai',
    jevModel: env.JEV_MODEL || 'jev-latest',
    fixturePath: env.JEV_FIXTURE || '',
    maxJobAttempts: parseInt(env.MAX_JOB_ATTEMPTS || '12000',10),
    maxProviderBodyBytes: parseInt(env.MAX_PROVIDER_BODY_BYTES || '2097152',10),
    providerAttemptTimeoutMs: parseInt(env.PROVIDER_ATTEMPT_TIMEOUT_MS || '45000',10),
    providerMaxAttemptsPerDecision: parseInt(env.PROVIDER_MAX_ATTEMPTS_PER_DECISION || '4',10),
    liveJev: env.LIVE_JEV==='1',
    version: '0.1.0'
  };
}

/** Stored operator settings (API key etc.) — lives in data/, never exported. */
interface StoredConfig { apiKey?:string; providerId?:ProviderId }
const settingsPath = (cfg:AppConfig) => join(cfg.dataDir,'settings.json');
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
/** Env wins; otherwise the operator's stored choice; otherwise the local default.
 *  There is NO silent fallback between providers (§9): a failing `local` does not fall
 *  through to `fixture`, and choosing `fixture` is explicit configuration. */
export function effectiveProvider(cfg:AppConfig):ProviderId {
  return providerFromEnv(env.JEV_PROVIDER) ?? readStored(cfg).providerId ?? cfg.providerId;
}
