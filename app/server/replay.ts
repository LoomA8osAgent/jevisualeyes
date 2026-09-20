/** THE REPLAY PROVIDER — a composed unit re-run from its OWN stored responses.
 *
 *  `docs/PLAN.md` §1 I4's acceptance: "a re-run from the stored responses at the same seed
 *  producing a byte-identical snapshot". That is what this is for, and it is the sharpest
 *  statement of `docs/COMPOSER.md` §4.4's replay rule — "the same stored responses plus the
 *  same initial PRNG state replay exactly" — made executable rather than asserted.
 *
 *  IT LOOKS UP AND NEVER INFERS, exactly as the fixture does not infer (§3.2): the key is
 *  `hashJSON(request)`, the canonical hash the spine already persists as `requestHash`, and
 *  a request the artifact does not carry is an ERROR naming its hash. A replay that answered
 *  a question it had never been asked would be a model, and a bad one.
 *
 *  IT ADOPTS THE RECORDED PROVIDER'S IDENTITY — id, model, class and provenance — because
 *  what it returns IS that provider's own recorded response. This is not laundering (§5):
 *  a synthetic answer replays as synthetic and a live one as live; the fact that THIS run
 *  was a replay is recorded in the unit artifact's envelope (`replayOf`), which is outside
 *  the snapshot on purpose, since a snapshot that changed because it was re-run could not
 *  be compared byte-for-byte with the one it is replaying.
 */
import type {DecisionProvider, DecisionRequest, DecisionResponse, ProviderClass,
  ProviderReceipt} from '../core/types.js';
import {hashJSON} from '../core/hash.js';

export class ReplayError extends Error {
  code='EJEVREPLAY';
  constructor(message:string){ super(message); this.name='ReplayError'; }
}

export interface ReplayCall { requestHash:string; request:DecisionRequest; response:DecisionResponse }
export interface ReplayIdentity {
  id:string; modelId:string; providerClass:ProviderClass; provenance:'live'|'synthetic';
}

export class ReplayProvider implements DecisionProvider {
  readonly id:string;
  readonly modelId:string;
  readonly providerClass:ProviderClass;
  readonly provenance:'live'|'synthetic';
  private byHash = new Map<string,DecisionResponse>();

  constructor(calls:ReplayCall[], identity:ReplayIdentity) {
    this.id=identity.id; this.modelId=identity.modelId;
    this.providerClass=identity.providerClass; this.provenance=identity.provenance;
    for (const c of calls) {
      // Trust the CANONICAL hash of the stored request, not the recorded string: the two
      // must agree, and if they do not, the artifact is the thing that is wrong.
      const h = hashJSON(c.request);
      if (c.requestHash && c.requestHash !== h)
        throw new ReplayError(`stored call ${c.requestHash} does not hash to its own request (${h}) ` +
          '— the artifact was edited or written by a different canonicalization');
      this.byHash.set(h, c.response);
    }
    if (!this.byHash.size) throw new ReplayError('a replay with no stored calls answers nothing');
  }

  /** Nothing here is retryable: a missing answer does not become present on a second look. */
  isRetryable():boolean { return false; }

  async decide(request:DecisionRequest, _signal:AbortSignal):Promise<ProviderReceipt> {
    const h = hashJSON(request);
    const response = this.byHash.get(h);
    if (!response) throw new ReplayError(
      `no stored response for request ${h} — the re-run asked something the recorded run did not. ` +
      'A replay looks up and never infers (docs/COMPOSER.md §3.2).');
    return {response, rawResponseHash:hashJSON(response), latencyMs:0, httpStatus:200};
  }
}
