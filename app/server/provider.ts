/** The HTTP decision provider: raw fetch, bounded body, NO retry layer here — retry is
 *  the runner's, and there is exactly ONE of them (`specs/ai/jev.md` §10.4).
 *
 *  ONE CLASS SERVES BOTH `local` AND `jev` because they speak the SAME wire (§1.1
 *  `POST <base>/v1/systemone`): the reference runtime is served over it by
 *  `von serve` (§9.4), and ~10 independent projects expose that exact route (§3.1). The
 *  only change of substance from upstream is that the endpoint was a hardcoded const and
 *  is now configuration (`roadmap/jevisualeyes-rework.md` §3).
 *
 *  The retryable status set — 408 429 500 502 503 504 529 — is upstream's and matches
 *  §10.4 exactly; it is kept verbatim.
 */
import {createHash} from 'node:crypto';
import type {DecisionProvider, DecisionRequest, ProviderClass, ProviderReceipt} from '../core/types.js';
import type {AppConfig} from './config.js';

export class ProviderError extends Error {
  constructor(message:string, public opts:{status?:number;retryable:boolean;retryAfterMs?:number;code:string}) {
    super(message); this.name='ProviderError';
  }
}
export const isRetryableStatus = (s:number):boolean =>
  [408,429,500,502,503,504,529].includes(s);

export interface HttpProviderOptions {
  id:string; baseUrl:string; modelId:string; providerClass:ProviderClass; apiKey?:string;
}

export class HttpDecisionProvider implements DecisionProvider {
  readonly id:string;
  readonly modelId:string;
  readonly providerClass:ProviderClass;
  readonly provenance='live' as const;
  private endpoint:string;
  private apiKey?:string;

  constructor(private cfg:AppConfig, opts:HttpProviderOptions) {
    this.id=opts.id; this.modelId=opts.modelId; this.providerClass=opts.providerClass;
    this.apiKey=opts.apiKey;
    this.endpoint=opts.baseUrl.replace(/\/+$/,'')+'/v1/systemone';
  }

  isRetryable(err:unknown):boolean {
    return err instanceof ProviderError ? err.opts.retryable : false;
  }

  async decide(request:DecisionRequest, signal:AbortSignal):Promise<ProviderReceipt> {
    const body = JSON.stringify(request);
    // §10.3 — the ceiling is enforced BEFORE the call. An over-ceiling request is
    // rebuilt from current state by the caller, never truncated and never replayed.
    if (Buffer.byteLength(body,'utf8') > this.cfg.maxProviderBodyBytes)
      throw new ProviderError('Request exceeds application payload ceiling',
        {retryable:false,code:'context_limit'});
    const ac = new AbortController();
    const timer = setTimeout(()=>ac.abort(new Error('timeout')), this.cfg.providerAttemptTimeoutMs);
    const onAbort = () => ac.abort((signal as any).reason);
    signal.addEventListener('abort', onAbort, {once:true});
    const started = performance.now();
    const headers:Record<string,string> = {'Content-Type':'application/json'};
    if (this.apiKey) headers.Authorization=`Bearer ${this.apiKey}`;
    try {
      const r = await fetch(this.endpoint, {method:'POST', headers, body, signal:ac.signal});
      const chunks:Buffer[]=[]; let size=0;
      if (r.body) {
        const reader = (r.body as any).getReader ? (r.body as any).getReader() : null;
        if (reader) {
          for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
            if(size>this.cfg.maxProviderBodyBytes){ac.abort();throw new ProviderError('Provider response size cap exceeded',{status:r.status,retryable:false,code:'provider_response_invalid'});}
            chunks.push(Buffer.from(value));}
        } else {
          const buf=Buffer.from(await r.arrayBuffer()); size=buf.length;
          if(size>this.cfg.maxProviderBodyBytes)throw new ProviderError('Provider response size cap exceeded',{status:r.status,retryable:false,code:'provider_response_invalid'});
          chunks.push(buf);
        }
      }
      const text = Buffer.concat(chunks).toString('utf8');
      const latencyMs = Math.round(performance.now()-started);
      if (!r.ok) {
        const retryAfter = r.headers.get('retry-after');
        let detail='';
        try{const d=JSON.parse(text)?.detail;detail=typeof d==='string'?d:d?.error_type??'';}catch{}
        throw new ProviderError(`Provider HTTP ${r.status}${detail?` (${detail})`:''}`, {
          status:r.status, retryable:isRetryableStatus(r.status),
          retryAfterMs: retryAfter? Math.min(120000, parseFloat(retryAfter)*1000||0) : undefined,
          code: r.status===401?'provider_auth':r.status===429?'provider_rate_limit':r.status===422?'provider_validation':'provider_error'
        });
      }
      let response:any;
      try { response = JSON.parse(text); }
      catch { throw new ProviderError('Provider returned malformed JSON',{status:r.status,retryable:false,code:'provider_response_invalid'}); }
      return {
        response,
        rawResponseHash: createHash('sha256').update(text,'utf8').digest('hex'),
        latencyMs, httpStatus:r.status,
        providerRequestId: r.headers.get('x-request-id') ?? undefined
      };
    } catch (e:any) {
      if (e instanceof ProviderError) throw e;
      if (e?.name==='AbortError' || ac.signal.aborted) {
        const reason = signal.aborted ? 'cancelled' : 'timeout';
        throw new ProviderError(`Provider attempt ${reason}`, {retryable:reason==='timeout', code:reason});
      }
      throw new ProviderError(`Connection failure: ${e?.message||'unknown'}`, {retryable:true, code:'connection'});
    } finally {
      clearTimeout(timer); signal.removeEventListener('abort', onAbort);
    }
  }
}

/** Build the configured provider. NEVER a silent fallback between providers (§9) —
 *  a misconfigured `jev` throws rather than quietly becoming `fixture`, and a failing
 *  `local` is an error the run reports, not a degraded mode. */
export function providerFor(cfg:AppConfig, providerId:string, key?:string,
                            makeFixture?:()=>DecisionProvider):DecisionProvider {
  if (providerId==='fixture') {
    if (!makeFixture) throw new ProviderError('Fixture provider requested but not supplied',
      {retryable:false,code:'provider_unavailable'});
    return makeFixture();
  }
  if (providerId==='jev') {
    if (!key) throw new ProviderError('Provider "jev" requires TYPESAFE_API_KEY',
      {retryable:false,code:'key_missing'});
    return new HttpDecisionProvider(cfg,{id:'jev',baseUrl:cfg.jevBaseUrl,modelId:cfg.jevModel,
      providerClass:'TRAINED',apiKey:key});
  }
  return new HttpDecisionProvider(cfg,{id:'local',baseUrl:cfg.localBaseUrl,
    modelId:cfg.localModel,providerClass:cfg.localClass});
}
