import {useEffect,useState} from 'react';
import {api,ProjectSummary} from '../api.js';
import type {Toast} from '../App.js';

export function PromptScreen({onCompose,onOpen,say}:
  {onCompose:(p:string)=>void;onOpen:(id:string)=>void;say:(t:string,k?:Toast['kind'])=>void}){
  const [prompt,setPrompt]=useState('');
  const [projects,setProjects]=useState<ProjectSummary[]>([]);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{api.projects().then(r=>setProjects(r.projects)).catch(()=>{});},[]);
  const go=async()=>{
    if(!prompt.trim()||busy)return;
    setBusy(true);try{await onCompose(prompt);}finally{setBusy(false);}
  };
  const importFile=async(f:File)=>{
    try{
      const json=JSON.parse(await f.text());
      const {id}=await api.importProject(json);
      onOpen(id);
    }catch(e:any){say(`Import failed: ${e.message}`,'error');}
  };
  return <div className="center"><div className="card">
    <h1>Describe music. Get an editable composition.</h1>
    <div className="sub">Jev decides each musical event live — every choice is auditable, and the score stays editable.</div>
    <textarea className="prompt" autoFocus placeholder="e.g. a wistful 3/4 waltz, soft keys over round bass, light swing, 16 bars"
      value={prompt} onChange={e=>setPrompt(e.target.value)}
      onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey))go();}}/>
    <div className="row" style={{marginTop:12}}>
      <button className="primary" disabled={!prompt.trim()||busy} onClick={go}>
        {busy?'Starting…':'Compose'}</button>
      <button onClick={async()=>{try{const{id}=await api.demoProject();onOpen(id);}catch(e:any){say(e.message,'error');}}}>
        Open hand-authored demo</button>
      <label className="dim" style={{cursor:'pointer',fontSize:13}}>
        Import project…
        <input type="file" accept=".json" style={{display:'none'}}
          onChange={e=>{const f=e.target.files?.[0];if(f)importFile(f);}}/>
      </label>
    </div>
    {projects.length>0&&<div className="list">
      {projects.map(p=><div key={p.id} className="listitem" onClick={()=>onOpen(p.id)}>
        <span>{p.title}<span className="dim" style={{marginLeft:8,fontSize:12}}>
          {p.lastJobStatus??(p.accepted_revision_id?'ready':'empty')}</span></span>
        <span className="dim" style={{fontSize:12}}>{new Date(p.updated_at).toLocaleString()}</span>
      </div>)}
    </div>}
  </div></div>;
}
