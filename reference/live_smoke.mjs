/** One explicitly opt-in, billable live API call. No automatic retries. */
import {readFile} from 'node:fs/promises';
import {validateChoiceResponse} from './core.mjs';
if(process.env.LIVE_JEV!=='1'||!process.env.TYPESAFE_API_KEY){
  console.error('Not run. Set LIVE_JEV=1 and TYPESAFE_API_KEY to authorize one live request.');
  process.exitCode=2;
}else{
  const request=JSON.parse(await readFile(new URL('../examples/jev-request.json',import.meta.url),'utf8'));
  request.model=process.env.JEV_MODEL||'jev-latest';
  const ac=new AbortController(), timer=setTimeout(()=>ac.abort(),45000),started=performance.now();
  try{
    const r=await fetch('https://api.typesafe.ai/v1/systemone',{
      method:'POST',headers:{Authorization:`Bearer ${process.env.TYPESAFE_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify(request),signal:ac.signal
    });
    if(!r.ok)throw new Error(`Provider HTTP ${r.status}; inspect secure server diagnostics. No retry made.`);
    if(!r.body)throw new Error('Empty response body');
    const reader=r.body.getReader(),chunks=[];let size=0;
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
      if(size>2097152){ac.abort();throw new Error('Response size cap exceeded');}chunks.push(Buffer.from(value));}
    const response=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const answer=validateChoiceResponse(response,request);
    console.log(JSON.stringify({live:true,requests:1,validated:true,model:response.model,selectedChoice:answer.choice,usage:response.usage,latencyMs:Math.round(performance.now()-started)},null,2));
  }catch(e){console.error(`Live smoke test did not complete: ${e.name==='AbortError'?'request aborted or timed out (billing may be unknown)':e.message}`);process.exitCode=1;}
  finally{clearTimeout(timer);}
}
