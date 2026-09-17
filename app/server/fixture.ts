/** Deterministic synthetic provider for fixture mode and tests.
 * Produces VALID ChoiceResponses with heuristic scores — clearly labeled synthetic,
 * never a silent fallback for the live provider. */
import {createHash} from 'node:crypto';
import type {ChoiceRequest, ChoiceResponse, DecisionProvider, ProviderReceipt} from '../core/types.js';
import {chordTones, noteName} from '../core/candidates.js';

const hashInt = (s:string):number => createHash('sha256').update(s).digest().readUInt32BE(0);
const jitter = (seed:number, key:string):number => (hashInt(seed+':'+key)%1000)/1000*0.002;

function pick(criteria:Record<string,string|null>, score:(key:string)=>number, seed:number):
  {choice:string;probabilities:Record<string,number>;confidence:number} {
  const keys=Object.keys(criteria).sort();
  const ws=keys.map(k=>Math.exp(score(k)+jitter(seed,k)));
  const total=ws.reduce((a,b)=>a+b,0);
  const probabilities=Object.fromEntries(keys.map((k,i)=>[k,ws[i]/total]));
  const maxI=ws.indexOf(Math.max(...ws));
  const confidence=probabilities[keys[maxI]];
  return {choice:keys[maxI],probabilities,confidence};
}

const word = (s:string, ...ws:string[]) => ws.some(w=>new RegExp(`\\b${w}\\b`,'i').test(s));

/** Prompt keyword → preferred groove parameter values, keyed `${role}.${axis}`.
 * Fixture-only heuristic so free mode demonstrates idiomatic parameter combos
 * for common genre words. Styles are coordinates — there is no genre table. */
const GROOVE_PREFS:[RegExp,Record<string,string>][]=[
  [/classical|mozart|beethoven|haydn|baroque|sonata/i,{
    'drums.kick':'sparse','drums.snare':'off','drums.hats':'sparse','drums.accent':'none',
    'bass.rhythm':'eighths','bass.pitches':'chord_tones',
    'harmony.attack':'arp','lead.syncopation':'onbeat'}],
  [/bossa|samba|latin|jobim/i,{
    'drums.kick':'sparse','drums.snare':'off','drums.hats':'eighths','drums.accent':'clave',
    'bass.rhythm':'dotted','bass.pitches':'root_fifth',
    'harmony.attack':'comp','lead.syncopation':'syncopated'}],
  [/waltz/i,{
    'drums.kick':'sparse','drums.snare':'sparse','drums.hats':'quarters','drums.accent':'none',
    'bass.rhythm':'sustained','bass.pitches':'root_fifth',
    'harmony.attack':'comp','lead.syncopation':'onbeat'}],
  [/techno|house|edm|dance|disco|trance|four on the floor|club/i,{
    'drums.kick':'driving','drums.snare':'backbeat','drums.hats':'eighths','drums.accent':'open_hat',
    'bass.rhythm':'eighths','bass.pitches':'root',
    'harmony.attack':'block','lead.density':'busy'}],
  [/trap|hip[\s-]?hop|drill|\brap\b/i,{
    'drums.kick':'syncopated','drums.snare':'third','drums.hats':'sixteenths','drums.accent':'none',
    'bass.rhythm':'sustained','bass.pitches':'root',
    'harmony.attack':'sparse','lead.syncopation':'syncopated'}],
  [/jazz|swing|bebop|jazzy/i,{
    'drums.kick':'sparse','drums.snare':'syncopated','drums.hats':'eighths','drums.accent':'none',
    'bass.rhythm':'quarters','bass.pitches':'walking',
    'harmony.attack':'comp','lead.syncopation':'syncopated'}],
  [/funk|r&b|soul|groovy/i,{
    'drums.kick':'syncopated','drums.snare':'backbeat','drums.hats':'eighths','drums.accent':'none',
    'bass.rhythm':'syncopated','bass.pitches':'chord_tones',
    'harmony.attack':'comp','lead.syncopation':'syncopated'}],
  [/ballad|ambient|calm|slow|sparse|sleepy|gentle/i,{
    'drums.kick':'off','drums.snare':'off','drums.hats':'sparse','drums.accent':'none',
    'bass.rhythm':'sustained','bass.pitches':'root',
    'harmony.attack':'sustain','lead.density':'sparse'}],
];
const GROOVE_DEFAULT:Record<string,string>={
  'drums.kick':'beats','drums.snare':'backbeat','drums.hats':'eighths','drums.accent':'none',
  'bass.rhythm':'quarters','bass.pitches':'root_fifth',
  'harmony.attack':'block','lead.density':'medium','lead.syncopation':'mixed'};

function scoreQuestion(qid:string, q:{criteria:Record<string,string|null>}, state:any, seed:number){
  const prompt:string = String(state.originalPrompt ?? state.task ?? '');
  const instruction:string = String(state.instruction ?? '');
  const bt=1920;
  if(qid.startsWith('groove_')){
    const role=(String((q as any).instructions??'').match(/Lane: (\w+)/)?.[1])??'lead';
    const axis=qid.slice(qid.lastIndexOf('_')+1);
    const prefs=GROOVE_PREFS.find(([re])=>re.test(prompt))?.[1]??GROOVE_DEFAULT;
    const pref=prefs[`${role}.${axis}`]??GROOVE_DEFAULT[`${role}.${axis}`]??null;
    return (key:string):number => key===pref?2.2:key==='any'&&pref?-0.6:0;
  }
  return (key:string):number => {
    const s=0;
    switch(qid){
      case 'meter':
        if(word(prompt,'waltz','3/4','three four')) return key==='M_3_4'?2:-1;
        if(word(prompt,'6/8','six eight','compound')) return key==='M_6_8'?2:-1;
        return key==='M_4_4'?1:0;
      case 'tempo':{
        const bpm=parseInt(key.slice(2),10);
        let center=100;
        if(word(prompt,'slow','sleepy','calm','lo-fi','lofi','ambient','ballad')) center=82;
        if(word(prompt,'blues')) center=86;
        if(word(prompt,'house','acid','techno','dance','driving','electro')) center=124;
        if(word(prompt,'fast','energetic','drum and bass','dnb')) center=150;
        return -Math.abs(bpm-center)/8;
      }
      case 'tonic':{
        const pc=parseInt(key.slice(2),10);
        return [9,0,7,4,2].includes(pc)?0.5:0;
      }
      case 'harmonicVocabulary':
        if(word(prompt,'blues')) return key==='blues_dominant'?3:-2;
        if(word(prompt,'minor','sad','dark','moody')) return key==='minor'?2:0;
        if(word(prompt,'weird','strange','chromatic')) return key==='chromatic_ambiguous'?2:0;
        return key==='major'?1:0;
      case 'feel':
        if(word(prompt,'swing','shuffle','blues','jazz')) return key==='shuffle'?2:0;
        if(word(prompt,'lo-fi','lofi','laid')) return key==='light_swing'?2:0;
        return key==='straight'?1:0;
      case 'form':
        if(word(prompt,'blues')) return key==='blues_chorus'?3:-1;
        if(word(prompt,'build','drop','house','edm','dance')) return key==='buildup_drop'?3:-1;
        if(word(prompt,'ambient','sparse','evolv')) return key==='sparse_evolving'?2:0;
        return key==='theme_contrast_return'?1:0;
      case 'density':
        if(word(prompt,'sparse','minimal','calm','room to breathe')) return key==='sparse'?2:0;
        if(word(prompt,'busy','intense','dense','fast')) return key==='busy'?2:0;
        return key==='medium'?1:0;
      case 'energyArc':
        if(word(prompt,'build','ris')) return key==='rising'?2:0;
        if(word(prompt,'calm','steady','flat')) return key==='steady'?1.5:0;
        return key==='rise_fall'?1:0;
      case 'lengthBars':{
        const n=parseInt(key.slice(2),10);
        return n===16?1.5 : n===12&&word(prompt,'blues')?2 : n===8?0.5 : n===24&&word(prompt,'blues')?1.5 : 0;
      }
      case 'lanePresence':
        return key==='L_lead+bass+harmony+drums'?2:key==='L_lead+bass+drums'?1:key==='L_lead+harmony'?0.5:-0.5;
      case 'phrase_intent':{
        const role:string=state.section?.role??'theme';
        const wantMap:Record<string,string>={intro:'introduce',theme:'introduce',variation:'vary_ending',contrast:'contrast',
          build:'build',drop:'resolve',return:'return',ending:'resolve'};
        const want=wantMap[role]??'introduce';
        return key===want?2:key==='repeat_recognizably'?0.3:0;
      }
      case 'harmony_progression':{
        if(key==='P_none') return -4;
        const degs=key.slice(2).split('_');
        const distinct=new Set(degs).size;
        const role:string=state.section?.role??'theme';
        let sc=distinct>=3?1.6:distinct===2?0.9:degs.length>1?0.5:-0.5;
        if(role==='contrast'||role==='variation') sc+=0.4;
        if(role==='return'&&state.priorProgressions?.length){
          const first=state.priorProgressions[0]?.progression;
          if(first===key) sc+=2.2; // recognizable return
        }
        return sc;
      }
      case 'next_event':{
        const lane=state.lane||{}; const cursor:number=state.cursorTick??0;
        const chord=state.currentHarmony;
        const tones=chord&&chord.rootPitchClass!==null?chordTones(chord.rootPitchClass,chord.quality):[];
        const lastPitch=[...(state.scoreSoFar||[])].reverse().find((n:any)=>n[1]===lane.id&&n[2]<cursor)?.[4];
        const density=state.plan?.density||'medium';
        if(key.startsWith('B_')){
          // bar-level options: score from the rendered description
          const desc=String(q.criteria[key]??'');
          const segs=desc.split(';').length;
          const isRest=/^rest /.test(desc);
          let sc=segs>=2&&segs<=5?1.2:segs>5?0.6:0.4;
          if(isRest)sc=density==='sparse'?0.2:-1.6;
          if(key==='B_motif')sc+=1.8;
          if(key==='B_hold')sc-=0.4;
          if(lane.role==='bass'){
            const root=chord&&chord.rootPitchClass!==null?['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][chord.rootPitchClass]:null;
            if(root&&desc.startsWith(root))sc+=1.2;
            if(/waltz|rock|fours|pump|walk|arp/.test(key))sc+=0.4;
          }
          if(lane.role==='harmony'&&desc.includes('+'))sc+=0.8;
          if(lane.role==='drums'&&desc.includes('kick'))sc+=0.7;
          if(density==='busy'&&segs>=4)sc+=0.5;
          if(density==='sparse'&&segs<=3)sc+=0.5;
          // deterministic per-bar variation so identical menus don't always pick the same pattern
          let h=0;const tag=key+':'+cursor+':'+lane.id;
          for(let i=0;i<tag.length;i++)h=(h*31+tag.charCodeAt(i))|0;
          sc+=((h>>>0)%1000)/1000*1.1;
          return sc;
        }
        const m=key.match(/^N_([\d_]+)_(\d+)$/);
        if(key.startsWith('R_')){
          const d=parseInt(key.slice(2),10);
          let sc=-1.2+(density==='sparse'?1.3:density==='busy'?-0.6:0);
          if(cursor%1920>=1440) sc+=0.6; // leave air at bar ends
          if(d>=960) sc-=1;
          return sc;
        }
        if(key.startsWith('H_')){
          const d=parseInt(key.slice(2),10);
          return -0.4+(d>=480?0.6:0);
        }
        if(!m) return -5;
        const pitches=m[1].split('_').map(Number), dur=parseInt(m[2],10);
        let sc=0;
        if(lane.role==='drums'){
          const has=(p:number)=>pitches.includes(p);
          const pos=cursor%1920;
          if(has(36)) sc += (pos===0)?2.2:(pos===960?0.6:-1);
          if(has(38)) sc += (pos===480||pos===1440)?1.8:-1.4;
          if(has(42)) sc += (pos%240===0)?0.9:0.1;
          if(has(46)) sc += (pos===1680)?0.8:-1.6;
          if(has(39)) sc += (pos===480||pos===1440)?0.8:-1.6;
          if(has(49)) sc += (cursor%(1920*4)===0)?1.5:-4;
          sc += dur<=240?0.5:dur===480?0.2:-1;
          return sc;
        }
        if(lane.role==='harmony'){
          sc += dur>=960?1.2:dur>=480?0.6:-0.8;
          const center=pitches.reduce((a,b)=>a+b,0)/pitches.length;
          sc += -Math.abs(center-60)/14;
          return sc;
        }
        // pitched lanes
        const midi=pitches[0];
        if(lastPitch!==undefined){
          const dist=Math.abs(midi-lastPitch);
          sc += dist===0?0.2:dist<=2?1.2:dist<=5?0.6:dist<=7?0:-1.5;
        }
        if(tones.length){
          if(tones.includes(midi%12)) sc+=1.3;
          if(lane.role==='bass'&&midi%12===chord.rootPitchClass) sc+=1.4;
        }
        if(cursor%480===0) sc+=0.4;
        sc += dur===240?0.7:dur===480?0.8:dur===960?0.1:dur>=1920?-1.2:-0.4;
        if(density==='busy') sc+= dur<=240?0.8:-0.3;
        if(density==='sparse') sc+= dur>=480?0.8:-0.4;
        return sc;
      }
      // edit-intent questions
      case 'operation':{
        const t=instruction;
        if(word(t,'slower','faster','tempo','bpm','speed')) return key==='setTempo'?3:-3;
        if(word(t,'organ','piano','keys','pluck','bass sound','instrument','replace the','sound like')) return key==='setInstrument'?3:-3;
        if(word(t,'louder','quieter','volume','gain')) return key==='setTrackGain'?3:-3;
        if(word(t,'mute','unmute','silence the')) return key==='setMute'?3:-3;
        if(word(t,'transpose','semitone','octave','higher','lower','up','down')&&!word(t,'tempo')) return key==='transpose'?3:-3;
        if(word(t,'lock','unlock','keep the','keep this','preserve')) return key==='setLocks'?3:-3;
        if(word(t,'duplicate','copy','repeat section')) return key==='duplicateRegion'?3:-3;
        if(word(t,'vocal','sing','lyric','audio')) return key==='unsupported'?3:-3;
        if(word(t,'busier','simpler','more','less','repetitive','different','change','make the','regenerate','redo','variation','surprising')) return key==='regenerate'?3:-3;
        return key==='ambiguous'?2:-2;
      }
      case 'targetLane':{
        const t=instruction;
        for(const lid of Object.keys(q.criteria)){
          if(lid==='ALL'||lid==='NONE') continue;
          if(new RegExp(`\\b${lid}\\b`,'i').test(t)) return key===lid?3:-3;
        }
        if(word(t,'melody','tune')) return key==='lead'?3:-3;
        if(word(t,'chord','pad')) return key==='harmony'?3:-3;
        if(word(t,'drum','beat','percussion')) return key==='drums'?3:-3;
        if(word(t,'everything','all','whole')) return key==='ALL'?2:0;
        return key==='NONE'?1:0;
      }
      case 'scope':{
        const t=instruction;
        if(word(t,'middle')) return key==='second_quarter'?0:key==='first_half'?0:0.2;
        if(word(t,'whole','entire','all','everything')) return key==='whole'?2:0;
        if(word(t,'end','last','final')) return key==='last_quarter'?2:0;
        if(word(t,'beginning','start','first','opening','intro')) return key==='first_quarter'?2:0;
        return state.explicitSelection?(key==='selection'?3:-1):(key==='whole'?1:0);
      }
      case 'direction':{
        const t=instruction;
        if(/\d+\s*(bpm|semitone|step|bar)/i.test(t)) return key==='exact'?3:-2;
        if(word(t,'less','fewer','simpler','slower','calmer','quieter','down','lower')) return key==='less'?3:-2;
        if(word(t,'more','busier','faster','denser','up','higher')) return key==='more'?3:-2;
        return key==='same'?0.5:0;
      }
      default:
        return s;
    }
  };
}

export class FixtureProvider implements DecisionProvider {
  calls:ChoiceRequest[]=[];
  /** Optional artificial latency (ms) per decision — for demos/tests of the
   *  progress UX without spending credits. Set via FIXTURE_DELAY_MS. */
  delayMs=parseInt(process.env.FIXTURE_DELAY_MS||'0',10)||0;
  async evaluate(request:ChoiceRequest, signal:AbortSignal):Promise<ProviderReceipt> {
    this.calls.push(request);
    if(this.delayMs)await new Promise((res,rej)=>{
      const t=setTimeout(res,this.delayMs);
      signal.addEventListener('abort',()=>{clearTimeout(t);rej(signal.reason??new Error('aborted'));},{once:true});
    });
    const reqHash=createHash('sha256').update(JSON.stringify(request),'utf8').digest('hex');
    const seed=hashInt(reqHash);
    const state=(request.state??{}) as Record<string,any>;
    const answers:Record<string,any>={};
    for(const [qid,q] of Object.entries(request.questions)){
      const r=pick(q.criteria, scoreQuestion(qid,q,state,seed+hashInt(qid)), seed+hashInt(qid));
      answers[qid]={type:'choice',...r};
    }
    const inputTokens=Math.ceil(JSON.stringify(request).length/4);
    const response:ChoiceResponse={model:'jev-fixture-synthetic',answers,
      usage:{input_tokens:inputTokens,output_tokens:64}};
    return {response,rawResponseHash:reqHash,latencyMs:5,httpStatus:200};
  }
}
