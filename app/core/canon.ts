/** Deterministic JSON canonicalization (jev-json-v1). Browser-safe: no node:crypto. */
const unsafeKeys = new Set(['__proto__','prototype','constructor']);
export const ok:(v:unknown,msg:string)=>asserts v = (v,msg) => { if (!v) throw new TypeError(msg); };
export const isInt = (v:unknown, lo=0, hi=Number.MAX_SAFE_INTEGER): v is number =>
  typeof v==='number' && Number.isSafeInteger(v) && v>=lo && v<=hi;
export const isPlain = (v:unknown): v is Record<string,unknown> =>
  v!==null && typeof v==='object' && !Array.isArray(v) &&
  [Object.prototype,null].includes(Object.getPrototypeOf(v));
export const clone = <T>(v:T):T => structuredClone(v);

export function canonicalJSON(value:unknown):string {
  const stack = new Set<object>();
  function walk(v:unknown, depth:number):string {
    ok(depth<=32, 'JSON depth limit');
    if (v===null || typeof v==='string' || typeof v==='boolean') return JSON.stringify(v);
    if (typeof v==='number') { ok(Number.isFinite(v), 'Nonfinite number'); return JSON.stringify(v); }
    ok(Array.isArray(v)||isPlain(v), 'Non-JSON value');
    ok(!stack.has(v as object), 'Cyclic JSON'); stack.add(v as object);
    let s:string;
    if (Array.isArray(v)) s='['+v.map(x=>walk(x,depth+1)).join(',')+']';
    else s='{'+Object.keys(v as Record<string,unknown>).sort().map(k=>{
      ok(!unsafeKeys.has(k),'Unsafe key');
      return JSON.stringify(k)+':'+walk((v as Record<string,unknown>)[k],depth+1);
    }).join(',')+'}';
    stack.delete(v as object); return s;
  }
  return walk(value,0);
}

