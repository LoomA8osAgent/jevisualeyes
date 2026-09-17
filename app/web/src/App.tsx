import {useCallback,useEffect,useRef,useState} from 'react';
import {api,JobSnapshot,ProjectDetail,newCommandId,ApiError} from './api.js';
import type {ProjectFile} from '@core/types.js';
import {createEngine,Engine} from './audio.js';
import {PromptScreen} from './screens/Prompt.js';
import {GeneratingScreen} from './screens/Generating.js';
import {StudioScreen} from './screens/Studio.js';
import {SettingsModal} from './components/Settings.js';

export type Toast={text:string;kind?:'info'|'error'|'warn'};

export function App(){
  const [screen,setScreen]=useState<'home'|'generating'|'studio'>('home');
  const [detail,setDetail]=useState<ProjectDetail|null>(null);
  const [job,setJob]=useState<JobSnapshot|null>(null);
  const [health,setHealth]=useState<{providerMode:string;providerConfigured:boolean}|null>(null);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [toast,setToast]=useState<Toast|null>(null);
  const engineRef=useRef<Engine|null>(null);
  if(!engineRef.current)engineRef.current=createEngine();

  const say=useCallback((text:string,kind:Toast['kind']='info')=>{
    setToast({text,kind});
    setTimeout(()=>setToast(t=>t?.text===text?null:t),4200);
  },[]);

  useEffect(()=>{api.health().then(setHealth).catch(()=>say('API unreachable','error'));},[]);

  const openProject=useCallback(async(id:string)=>{
    try{
      const d=await api.project(id);
      setDetail(d);
      if(d.activeJob&&!['completed','cancelled'].includes(d.activeJob.status)){
        setJob(d.activeJob);setScreen('generating');
      }else if(d.project){setJob(null);setScreen('studio');}
      else{setJob(null);setScreen('home');say('Project has no music yet — compose from the home screen','warn');}
    }catch(e:any){say(e.message,'error');}
  },[say]);

  const refresh=useCallback(async()=>{
    if(!detail)return;
    try{setDetail(await api.project(detail.id));}catch{}
  },[detail]);

  const startCompose=useCallback(async(prompt:string)=>{
    try{
      const {projectId,jobId}=await api.compose(prompt);
      setDetail(await api.project(projectId));
      setJob(await api.job(jobId));
      setScreen('generating');
    }catch(e:any){say(e.message,'error');if(e.code==='key_missing')setSettingsOpen(true);}
  },[say]);

  return <div className="screen">
    <div className="topbar">
      <div className="title"><img className="logo" src="/icon.jpg" alt="Jevthoven" /></div>
      {health&&<span className={`badge ${health.providerMode==='fixture'?'fixture':'live'}`}>
        {health.providerMode==='fixture'?'fixture provider':'live jev'}</span>}
      {detail&&screen!=='home'&&<span className="kv"><b>{detail.title}</b></span>}
      {detail?.project&&<span className={`badge ${detail.project.generation.provenance==='fixture'?'fixture':'live'}`}>
        {detail.project.generation.provenance}</span>}
      <div className="spacer"/>
      {screen!=='home'&&<button onClick={()=>{engineRef.current!.stop();setScreen('home');setDetail(null);}}>Projects</button>}
      <button onClick={()=>setSettingsOpen(true)}>Settings</button>
    </div>
    {screen==='home'&&<PromptScreen onCompose={startCompose} onOpen={openProject} say={say}/>}
    {screen==='generating'&&job&&detail&&
      <GeneratingScreen key={job.id} job={job} projectId={detail.id}
        onJob={setJob} onDone={async()=>{
          const d=await api.project(detail.id);setDetail(d);
          setScreen(d.project?'studio':'home');}}
        say={say} engine={engineRef.current!}/>}
    {screen==='studio'&&detail&&
      <StudioScreen detail={detail} onRefresh={refresh} say={say} engine={engineRef.current!}
        onJobStarted={j=>{setJob(j);setScreen('generating');}}/>}
    {settingsOpen&&<SettingsModal onClose={()=>{setSettingsOpen(false);api.health().then(setHealth).catch(()=>{});}}/>}
    {toast&&<div className="toast" style={{borderColor:toast.kind==='error'?'var(--danger)':toast.kind==='warn'?'var(--warn)':'var(--line)'}}>{toast.text}</div>}
  </div>;
}
