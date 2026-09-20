/** THE WRITE — a composed unit lands in the consuming app's OWN source-keyed preset bank.
 *
 *  `docs/PLAN.md` §1 I5. `docs/COMPOSER.md` §1: "A composed unit leaves this tool immediately
 *  and lands in the consumer's own source-keyed preset bank through the consumer's own write
 *  path; a bake whose results only existed in its own database would be a second writer for
 *  state the app owns." This file is that write, and it owns exactly four obligations:
 *
 *    1. THE APP'S OWN ENDPOINT — `POST /api/preset-bank/<key>` with `{presets}`, the same
 *       route `js/picker-lib.js` pickerLibSaveSourceBank posts to. No new endpoint, no
 *       direct file write into `app-config/source-presets/`: a writer that reached around
 *       the server would be a second writer wearing a different hat.
 *    2. THE KEY IS THE APP'S, AND IT IS HANDED IN — never derived here. ⚠ MEASURED
 *       2026-09-20, and it is the finding of this increment: a record's card source is
 *       COMPOSED AT LOAD TIME, and what it composes to depends on LIVE APP STATE — the
 *       user palette store is emitted into the shader's palette roster, so adding one
 *       palette changes the composed bytes and therefore the sha the bank is keyed by.
 *       An offline derivation was built, run, and REJECTED by the app's own key: it
 *       produced `src_f644e2…` where the running card computed `src_80d395…`, a 212-byte
 *       divergence in the palette list plus one environment-dependent comment line. A
 *       writer that guesses a key does not fail loudly — it writes a bank no card will
 *       ever open, which is a PRESET-HOLE with a green log beside it. So the key comes
 *       FROM a loaded card (`jev.composed-preset-key`), and there is no fallback.
 *    3. REFUSE A LIVE BANK. The endpoint is LAST-WRITE-WINS over the whole bank body, and
 *       the operator may have the app open on the same source (`docs/PLAN.md` §2, the
 *       smaller risk). So the bank is read, the merge is built, and the bank is read AGAIN
 *       immediately before the POST: if it moved in between, a live card is saving into it
 *       and this run REFUSES, printing both states' slot sets. A compare-and-swap, not a
 *       lock — there is nothing to lock against a browser.
 *    4. READ BACK AND ASSERT. After the POST the bank is read once more and the written
 *       slot is compared for deep equality with what was sent. A write that "succeeded" and
 *       stored something else is a failure, and only the read-back can see it
 *       (GATE-FAILS-OPEN: a 200 is not evidence).
 *
 *  WHAT IT NEVER TOUCHES. The card's own provenance chain: a card chain is not preset state
 *  in that app ("What presets do NOT save: Provenance chain", `specs/preset-json.md`). The
 *  ONE append this writer owes rides `generation.provenance.chain`, in the app's own
 *  `prvAppend` entry shape — see `core/slot.ts` §DeliveredGeneration.
 */
import type {AppConfig} from './config.js';
import {loadConfig} from './config.js';
import {readUnitArtifact} from './compose.js';
import type {ComposedUnit} from './compose.js';
import {loadRosters} from '../core/rosters.js';
import {renderSlot, blendOrderFrom} from '../core/slot.js';
import type {PresetSlot, RenderedSlot} from '../core/slot.js';
import {hashJSON} from '../core/hash.js';

/** The bank body the app's endpoint stores and serves: `{presets: {slot: snapshot}}`. */
export interface PresetBank { presets:Record<string,unknown>; [k:string]:unknown }

/** The wire, as an interface, for ONE reason: the live-bank refusal (§3) is a race by
 *  nature, and a refusal that has never been made to fire is indistinguishable from one
 *  that cannot (the rule `docs/PLAN.md` §1 I2 states for the validator). A test drives a
 *  transport that mutates the bank between the two reads; nothing else overrides it. */
export interface BankTransport {
  get(key:string):Promise<PresetBank>;
  post(key:string, body:PresetBank):Promise<void>;
}

export class DeliverRefusal extends Error {
  constructor(message:string, readonly detail?:Record<string,unknown>) {
    super(message); this.name = 'DeliverRefusal';
  }
}

/** The app's dev-server endpoint. `GET` answers `{presets:{}}` for an unknown key, which is
 *  the app's own behaviour and is NOT treated as an error — a first write to a source that
 *  has never been saved is the ordinary case. */
export function httpTransport(baseUrl:string):BankTransport {
  const url = (key:string) => `${baseUrl.replace(/\/+$/,'')}/api/preset-bank/${encodeURIComponent(key)}`;
  return {
    async get(key) {
      const r = await fetch(url(key));
      if (!r.ok) throw new DeliverRefusal(
        `the app's preset-bank endpoint answered ${r.status} for GET ${url(key)} — the write is ` +
        'not attempted against a server that cannot be read back (a 200 on POST would then be ' +
        'the only evidence, and it is not evidence)');
      const j = await r.json() as PresetBank;
      return (j && typeof j.presets === 'object' && j.presets) ? j : {presets:{}};
    },
    async post(key, body) {
      const r = await fetch(url(key), {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)
      });
      if (!r.ok) throw new DeliverRefusal(
        `the app's preset-bank endpoint answered ${r.status} for POST ${url(key)}`);
    }
  };
}

export interface DeliverOptions {
  artifactPath:string;
  /** THE APP'S OWN BANK KEY for this record's card — `card._srcPresetKey`, read off a
   *  loaded card by the `jev.composed-preset-key` macro. Required, and deliberately so:
   *  see the header. */
  key:string;
  /** which numbered slot. `D` is the card's own factory face and is never written here. */
  slot?:string;
  baseUrl?:string;
  overrides?:Partial<AppConfig>;
  transport?:BankTransport;
  now?:string;
}

export interface DeliverReport {
  recordId:string; tag:string; seed:number;
  key:string; slot:string; baseUrl:string;
  /** the slots the bank already held, before this write. */
  slotsBefore:string[]; slotsAfter:string[];
  /** what the render declined to carry, and why (`core/slot.ts` §the bind). */
  refused:{key:string;reason:string}[];
  /** sha256 of the slot as SENT and as READ BACK. Equal, or this threw. */
  sentSha256:string; readBackSha256:string;
  chainEntries:number; receipts:number; unitSha256:string;
}

export async function deliverUnit(o:DeliverOptions):Promise<{report:DeliverReport; slot:PresetSlot}> {
  const cfg:AppConfig = {...loadConfig(), ...(o.overrides ?? {})};
  const baseUrl = o.baseUrl ?? process.env.JEV_APP_URL ?? 'http://127.0.0.1:8080';
  const slotId = o.slot ?? '1';
  if (slotId === 'D') throw new DeliverRefusal(
    'slot D is the card\'s own first-compile face, re-seeded by the app itself; a composed ' +
    'unit is written to a NUMBERED slot so the operator can always get back to the record ' +
    'the way it shipped');

  const key = String(o.key ?? '').trim();
  if (!/^(src|lbl)_[A-Za-z0-9._-]+$/.test(key)) throw new DeliverRefusal(
    `"${key}" is not an app preset-bank key. The key is READ OFF A LOADED CARD ` +
    '(`card._srcPresetKey`, published by the `jev.composed-preset-key` macro) and never ' +
    'derived here — a record composes at LOAD time against live app state, so an offline ' +
    'derivation can write a bank no card will ever open');

  const unit:ComposedUnit = readUnitArtifact(o.artifactPath);
  const rosters = loadRosters(cfg.appRoot, cfg.rostersArtifact);
  const rendered:RenderedSlot = renderSlot(unit, {
    rosters, blendOrder:blendOrderFrom(rosters), ...(o.now ? {now:o.now} : {})
  });
  const tx = o.transport ?? httpTransport(baseUrl);

  // ── §3 the live-bank refusal — read, build, read again, compare ────────────────────
  const before = await tx.get(key);
  const beforeHash = hashJSON(before.presets as Record<string,unknown>);
  const merged:PresetBank = {...before, presets:{...before.presets, [slotId]:rendered.slot}};
  const again = await tx.get(key);
  if (hashJSON(again.presets as Record<string,unknown>) !== beforeHash) throw new DeliverRefusal(
    `REFUSED: the preset bank ${key} changed between two reads — a live card is saving into ` +
    'it, and this endpoint is last-write-wins over the whole bank body, so writing now would ' +
    'silently discard the operator\'s save',
    {key, slotsFirstRead:Object.keys(before.presets).sort(), slotsSecondRead:Object.keys(again.presets).sort()});

  await tx.post(key, merged);

  // ── §4 read back and assert ────────────────────────────────────────────────────────
  const after = await tx.get(key);
  const sentSha = hashJSON(rendered.slot as unknown as Record<string,unknown>);
  const got = after.presets[slotId];
  if (got === undefined) throw new DeliverRefusal(
    `REFUSED: slot ${slotId} is absent from ${key} after a write the endpoint accepted`,
    {key, slotsAfter:Object.keys(after.presets).sort()});
  const gotSha = hashJSON(got as Record<string,unknown>);
  if (gotSha !== sentSha) throw new DeliverRefusal(
    `REFUSED: slot ${slotId} of ${key} reads back different from what was sent ` +
    `(${sentSha.slice(0,16)}… vs ${gotSha.slice(0,16)}…) — the POST returned 200 and stored ` +
    'something else, which only the read-back can see',
    {key, slot:slotId});

  return {
    slot:rendered.slot,
    report:{
      recordId:unit.recordId, tag:unit.tag, seed:unit.seed,
      key, slot:slotId, baseUrl,
      slotsBefore:Object.keys(before.presets).sort(),
      slotsAfter:Object.keys(after.presets).sort(),
      refused:rendered.refused,
      sentSha256:sentSha, readBackSha256:gotSha,
      chainEntries:rendered.slot.generation.provenance.chain.length,
      receipts:unit.receipts.length,
      unitSha256:unit.snapshotSha256
    }
  };
}
