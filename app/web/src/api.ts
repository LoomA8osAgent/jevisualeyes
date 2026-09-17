import type {ProjectFile} from '@core/types.js';

export interface JobSnapshot {
  id:string; projectId:string; status:string; phase:string; mode:string;
  epoch:number; decisionIndex:number; attemptCount:number; attemptLimit:number;
  usage:{inputTokens:number;outputTokens:number;requests:number;missing:number};
  laneCursors:Record<string,number>; completedThroughTick:number; completedBars:number;
  barTicks:number; scope:{trackIds:string[];startTick:number;endTick:number};
  plan:any; accepted:boolean; discarded:boolean;
  errorCode:string|null; errorMessage:string|null; resumeAt:string|null;
  preview:ProjectFile|null;
}
export interface ProjectSummary {id:string;title:string;created_at:string;updated_at:string;accepted_revision_id:string|null;lastJobStatus:string|null}
export interface ProjectDetail {id:string;title:string;createdAt:string;updatedAt:string;
  acceptedRevisionId:string|null;aux:Record<string,unknown>;project:ProjectFile|null;activeJob:JobSnapshot|null}
export interface Settings {hasKey:boolean;keyFromEnv:boolean;providerMode:'live'|'fixture';model:string;
  limits:Record<string,number>;instruments:{id:string;name:string;roles:string[];program:number}[]}

class ApiError extends Error {
  constructor(public code:string,message:string,public retryable:boolean,public details?:unknown,public status=0){super(message);}
}

const req=async<T>(path:string,opts:RequestInit={}):Promise<T>=>{
  const r=await fetch(path,{headers:{'content-type':'application/json',...(opts.headers||{})},...opts});
  if(!r.ok){
    let e:any={code:'http_'+r.status,message:r.statusText,retryable:r.status>=500};
    try{e=await r.json();}catch{}
    throw new ApiError(e.code,e.message,e.retryable??false,e.details,r.status);
  }
  return r.json();
};
const post=<T>(path:string,body:unknown)=>req<T>(path,{method:'POST',body:JSON.stringify(body)});
export const newCommandId=()=>`cmd_${crypto.randomUUID().replaceAll('-','').slice(0,16)}`;

export const api={
  health:()=>req<{ok:boolean;providerConfigured:boolean;providerMode:string;model:string}>('/api/health'),
  settings:()=>req<Settings>('/api/settings'),
  saveSettings:(patch:{apiKey?:string;providerMode?:string})=>post<Settings>('/api/settings',patch),
  projects:()=>req<{projects:ProjectSummary[]}>('/api/projects'),
  project:(id:string)=>req<ProjectDetail>(`/api/projects/${id}`),
  createProject:(title?:string)=>post<{id:string}>('/api/projects',{title}),
  importProject:(project:unknown)=>post<{id:string}>('/api/projects',{project,commandId:newCommandId()}),
  demoProject:()=>post<{id:string;demo:boolean}>('/api/projects/demo',{}),
  deleteProject:(id:string)=>fetch(`/api/projects/${id}`,{method:'DELETE'}).then(r=>r.json()),
  compose:(prompt:string,opts:Record<string,unknown>={})=>
    post<{projectId:string;jobId:string}>('/api/compose',{prompt,commandId:newCommandId(),...opts}),
  startJob:(projectId:string,mode:string,instruction:string,scope?:unknown,opts:Record<string,unknown>={})=>
    post<{jobId:string}>(`/api/projects/${projectId}/jobs`,
      {mode,instruction,commandId:newCommandId(),baseRevisionId:opts.baseRevisionId,scope,...opts}),
  job:(id:string)=>req<JobSnapshot>(`/api/jobs/${id}`),
  jobEvents:(id:string,lastEventId:number)=>new EventSource(`/api/jobs/${id}/events`+(lastEventId>=0?`?last=${lastEventId}`:'')),
  pauseJob:(id:string)=>post(`/api/jobs/${id}/pause`,{}),
  resumeJob:(id:string)=>post(`/api/jobs/${id}/resume`,{}),
  cancelJob:(id:string)=>post(`/api/jobs/${id}/cancel`,{}),
  acceptJob:(id:string)=>post<{revisionId:string}>(`/api/jobs/${id}/accept`,{}),
  discardJob:(id:string)=>post(`/api/jobs/${id}/discard`,{}),
  command:(projectId:string,baseRevisionId:string,op:string,args:Record<string,unknown>={})=>
    post<{revisionId:string}>(`/api/projects/${projectId}/commands`,{commandId:newCommandId(),baseRevisionId,op,...args}),
  nlEdit:(projectId:string,baseRevisionId:string,instruction:string,selection?:unknown)=>
    post<any>(`/api/projects/${projectId}/edits`,{commandId:newCommandId(),baseRevisionId,instruction,selection}),
  undo:(projectId:string)=>post<{revisionId:string}>(`/api/projects/${projectId}/undo`,{}),
  redo:(projectId:string)=>post<{revisionId:string}>(`/api/projects/${projectId}/redo`,{}),
  exportUrl:(projectId:string,format:'json'|'midi')=>`/api/projects/${projectId}/export?format=${format}`,
};
export {ApiError};
