/** Live Jev provider adapter: raw fetch, bounded body, no retry layer here. */
import {createHash} from 'node:crypto';
import type {ChoiceRequest, DecisionProvider, ProviderReceipt} from '../core/types.js';
import type {AppConfig} from './config.js';

export class ProviderError extends Error {
  constructor(message:string, public opts:{status?:number;retryable:boolean;retryAfterMs?:number;code:string}) {
    super(message); this.name='ProviderError';
  }
}
export const isRetryableStatus = (s:number):boolean =>
  [408,429,500,502,503,504,529].includes(s);

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

export class LiveProvider implements DecisionProvider {
  constructor(private cfg:AppConfig, private apiKey:string) {}

  async evaluate(request:ChoiceRequest, signal:AbortSignal):Promise<ProviderReceipt> {
    const body = JSON.stringify(request);
    if (Buffer.byteLength(body,'utf8') > this.cfg.maxProviderBodyBytes)
      throw new ProviderError('Request exceeds application payload ceiling',
        {retryable:false,code:'context_limit'});
    const ac = new AbortController();
    const timer = setTimeout(()=>ac.abort(new Error('timeout')), this.cfg.providerAttemptTimeoutMs);
    const onAbort = () => ac.abort((signal as any).reason);
    signal.addEventListener('abort', onAbort, {once:true});
    const started = performance.now();
    try {
      const r = await fetch(ENDPOINT, {
        method:'POST',
        headers:{Authorization:`Bearer ${this.apiKey}`,'Content-Type':'application/json'},
        body, signal:ac.signal
      });
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
