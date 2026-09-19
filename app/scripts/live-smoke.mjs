/** ONE explicitly opt-in, billable live call. No retries, no test, no gate.
 *
 *  `jev.md` §9 and `roadmap/jevisualeyes-rework.md` §3: live smoke is exactly ONE call,
 *  behind both an explicit flag AND a present key, never during install, build, the test
 *  run or any gate. The guard below is upstream's shape, kept because it is correct.
 *
 *  It asks the REAL axis question for one record — not an inherited fixture — so what
 *  it proves is the wire this tool actually uses.
 *
 *    LIVE_JEV=1 TYPESAFE_API_KEY=... node --run test:live
 */
import {loadConfig, effectiveKey} from '../server/config.js';
import {HttpDecisionProvider} from '../server/provider.js';
import {buildAxisRequest} from '../core/requests.js';
import {validateResponse} from '../core/validate.js';

const cfg = loadConfig();
const key = effectiveKey(cfg);
if (process.env.LIVE_JEV !== '1' || !key) {
  console.error('Not run. Set LIVE_JEV=1 and TYPESAFE_API_KEY to authorize one live request.');
  process.exitCode = 2;
} else {
  const provider = new HttpDecisionProvider(cfg, {id:'jev', baseUrl:cfg.jevBaseUrl,
    modelId:cfg.jevModel, providerClass:'TRAINED', apiKey:key});
  const request = buildAxisRequest(cfg.jevModel, {
    recordId:'waves/ocean', situation:'an open sea surface seen from above',
    family:'waves', tag:'motion:driving density:busy contrast:hard'
  }, ['shape']);
  const ac = new AbortController();
  try {
    const receipt = await provider.decide(request, ac.signal);
    const answers = validateResponse(receipt.response, request);
    console.log(JSON.stringify({live:true, requests:1, validated:true,
      provider:provider.id, model:receipt.response.model,
      answers:Object.fromEntries(Object.entries(answers)
        .map(([k,a]) => [k, a.type==='choice' ? {choice:a.choice, confidence:a.confidence} : a])),
      usage:receipt.response.usage, latencyMs:receipt.latencyMs}, null, 2));
  } catch (e) {
    console.error(`Live smoke did not complete: ${e?.message || e}`);
    process.exitCode = 1;
  }
}
