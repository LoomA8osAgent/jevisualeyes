/** Regenerate synthetic examples only. Never calls a model. */
import {readFile,writeFile} from 'node:fs/promises';
import {buildCandidates,criteriaFor,hashJSON,encodeSMF} from './core.mjs';
const base=new URL('../examples/',import.meta.url);
const write=(name,x)=>writeFile(new URL(name,base),JSON.stringify(x,null,2)+'\n');
const candidates=buildCandidates({pitches:Array.from({length:24},(_,i)=>60+i),spans:[120,240,480,960],remaining:1440});
const request={
  model:'jev-latest',
  state:{task:'Compose the next musical event',originalPrompt:'A slow blues melody with room to breathe',ppq:480,meter:[4,4],tempoBpm:84,lane:{id:'lead',role:'lead',instrument:'electric_keys'},cursorTick:480,boundaryTick:1920,currentHarmony:{rootPitchClass:9,quality:'dominant7'},scoreSoFar:[['n1','lead',0,480,69,84]],phraseIntent:'Develop the opening idea without filling every beat'},
  questions:{next_event:{type:'choice',instructions:'Choose the concrete next event that best continues this instrumental phrase. Consider the original request, existing notes, position, harmony and phrase intent. Choose only from the supplied complete events.',criteria:criteriaFor(candidates,480)}}
};
const choice='N_72_240';
const probabilities=Object.fromEntries(candidates.map(c=>[c.id,c.id===choice?.55:.45/(candidates.length-1)]));
const response={model:'jev-latest',answers:{next_event:{type:'choice',choice,confidence:.4,probabilities}},usage:{input_tokens:1234,output_tokens:123}};
const receipt={schemaVersion:'jev-music.receipt.v1',id:'synthetic-d1',jobId:'synthetic-job',decisionIndex:0,attemptIndex:1,requestHash:hashJSON(request),candidateHash:hashJSON(candidates),model:'jev-latest',questionId:'next_event',providerChoice:choice,selectedChoice:choice,selectionMode:'model',seedBefore:123456789,seedAfter:123456789,usage:{inputTokens:1234,outputTokens:123,complete:true},latencyMs:0,provenance:'synthetic'};
await write('jev-request.json',request);await write('jev-response.synthetic.json',response);await write('decision-receipt.synthetic.json',receipt);await write('event-candidates.json',candidates);
const project=JSON.parse(await readFile(new URL('hand-authored-project.json',base),'utf8'));
await writeFile(new URL('hand-authored-example.mid',base),encodeSMF(project));
console.log('Generated synthetic fixtures and a hand-authored MIDI. No network calls.');
