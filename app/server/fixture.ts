/** The `fixture` DecisionProvider — `docs/COMPOSER.md` §3.2.
 *
 *  THE FIXTURE IS TOLD WHAT TO ANSWER AND NEVER INFERS ONE FROM THE STATE. A planted bad
 *  input produces a planted bad answer, so the code's own logic is what is under test; a
 *  fixture that inferred would be a second, worse model, and the thing under test would no
 *  longer be the code.
 *
 *  It shares its map format, its "a missing map is an ERROR" rule and its `synthetic` stamp
 *  with the consuming app's own fixture provider. The validator it calls is this repo's own
 *  `core/validate.ts`, so there remains exactly ONE validation implementation here — the
 *  fixture passes the SAME checks a real provider does.
 *
 *  It is NEVER a silent fallback (§3.2): a failing `local` provider does not fall through
 *  to this one. Choosing it is explicit configuration (`JEV_PROVIDER=fixture`).
 *
 *  The map, loaded from the configured path:
 *
 *    {
 *      "default": 0.9,                    // any question id not named below
 *      "answers": {
 *        "moving_twist":      0.97,       // a noul   → the probability, verbatim
 *        "look_shape":        "look_2",   // a choice → this key takes `peak`
 *        "rate_twist":        2           // a score  → this ladder index
 *      }
 *    }
 */
import {readFileSync} from 'node:fs';
import type {DecisionProvider, DecisionRequest, DecisionAnswer, ProviderReceipt} from '../core/types.js';
import {candidateKeys, validateAnswer} from '../core/validate.js';
import {hashJSON} from '../core/hash.js';

export class FixtureError extends Error {
  code='EJUDGMENTFIXTURE';
  constructor(message:string){ super(message); this.name='FixtureError'; }
}

interface FixtureMap { default?:number; answers?:Record<string,string|number|boolean> }

/** A missing file is an ERROR, not an empty map: a fixture that silently answered
 *  `default` to everything because its map was mis-pathed would be the fail-open shape
 *  inside the very thing built to prevent it. */
function loadMap(path:string):FixtureMap {
  if(!path) throw new FixtureError('JEV_FIXTURE is not set — the fixture provider has no map to answer from');
  let raw:string;
  try { raw=readFileSync(path,'utf8'); }
  catch(e:any){ throw new FixtureError(`fixture map unreadable at ${path}: ${e?.message||e}`); }
  try { return JSON.parse(raw); }
  catch(e:any){ throw new FixtureError(`fixture map at ${path} is not valid JSON: ${e?.message||e}`); }
}

const round4 = (v:number) => Math.round(v*1e4)/1e4;

/** A distribution with `peak` on one index and the remainder spread evenly, summing to
 *  exactly 1 after rounding — a double that could not pass the client's own validator
 *  would be useless as a double. */
function spread(k:number, idx:number, peak:number):number[] {
  const out=new Array<number>(k); const rest=k>1?(1-peak)/(k-1):0; let sum=0;
  for(let i=0;i<k;i++){ out[i]=round4(i===idx?peak:rest); sum+=out[i]; }
  out[idx]=round4(out[idx]+(1-sum));
  return out;
}
/** Normalized entropy — the same confidence definition the app-tree providers use. */
export function confidenceFromProbs(p:number[]):number {
  const k=p.length; if(k<2)return 1;
  let ent=0;
  for(let i=0;i<k;i++){ const v=Math.min(1,Math.max(1e-12,p[i])); ent-=p[i]*Math.log(v); }
  return round4(1-ent/Math.log(k));
}

export class FixtureProvider implements DecisionProvider {
  readonly id='fixture';
  readonly providerClass='FIXTURE' as const;   // §3.1 — neither TRAINED nor DECODE
  readonly provenance='synthetic' as const;    // §5 — stamped on every receipt
  readonly modelId:string;
  private map:FixtureMap|null=null;

  constructor(private path:string, modelId='fixture-1'){ this.modelId=modelId; }

  isRetryable():boolean { return false; }

  async decide(request:DecisionRequest, _signal:AbortSignal):Promise<ProviderReceipt> {
    if(!this.map) this.map=loadMap(this.path);
    const started=performance.now();
    const planted=this.map.answers??{};
    const dflt=typeof this.map.default==='number'?this.map.default:0.9;
    const answers:Record<string,DecisionAnswer>={};

    for(const [qid,q] of Object.entries(request.questions)){
      const planned=(qid in planted)?planted[qid]:null;

      if(q.type==='noul'){
        const v = typeof planned==='number' ? planned
                : typeof planned==='boolean' ? (planned?0.97:0.03)
                : dflt;
        if(!Number.isFinite(v)||v<0||v>1)
          throw new FixtureError(`fixture: planted noul for "${qid}" is not a probability: ${planned}`);
        answers[qid]={type:'noul',noul:round4(v)};
        continue;
      }

      const keys=candidateKeys(q);
      const idx = typeof planned==='string' ? keys.indexOf(planned)
                : typeof planned==='number' ? Math.round(planned) : 0;
      if(idx<0||idx>=keys.length)
        throw new FixtureError(q.type==='choice'
          ? `fixture: planted choice "${planned}" for "${qid}" is not a submitted candidate`
          : `fixture: planted score ${planned} for "${qid}" is outside the submitted ladder [0,${keys.length-1}]`);
      const p=spread(keys.length,idx,Math.max(dflt,1/keys.length));
      const probabilities=Object.fromEntries(keys.map((k,i)=>[k,p[i]]));
      const confidence=confidenceFromProbs(p);
      if(q.type==='choice'){
        answers[qid]={type:'choice',choice:keys[idx],probabilities,confidence};
      } else {
        let exp=0; for(let j=0;j<keys.length;j++) exp+=j*p[j];
        answers[qid]={type:'score',score:round4(exp),probabilities,confidence,
          legend:Object.fromEntries(q.criteria.map((lvl,i)=>[String(i),lvl]))};
      }
    }

    // The fixture passes the SAME §4.1 validation the real provider does.
    for(const [qid,q] of Object.entries(request.questions)){
      try { validateAnswer(answers[qid],q,qid); }
      catch(e:any){ throw new FixtureError(`fixture: §4.1 validation failed on its own output: ${e?.message||e}`); }
    }

    const response={model:this.modelId,answers,usage:{input_tokens:0,output_tokens:0}};
    return {response, rawResponseHash:hashJSON(response),
      latencyMs:Math.round(performance.now()-started), httpStatus:200};
  }
}
