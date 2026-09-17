import {useEffect,useState} from 'react';
import {api,Settings as S} from '../api.js';

/** Settings modal: API key entry + provider mode. Key is stored server-side only. */
export function SettingsModal({onClose}:{onClose:()=>void}){
  const [s,setS]=useState<S|null>(null);
  const [key,setKey]=useState('');
  const [saved,setSaved]=useState(false);
  useEffect(()=>{api.settings().then(setS).catch(()=>{});},[]);
  const save=async(patch:{apiKey?:string;providerMode?:string})=>{
    try{setS(await api.saveSettings(patch));setSaved(true);setTimeout(()=>setSaved(false),1500);}
    catch{/* surfaced via toast-free inline */}
  };
  return <div className="modal" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="card">
      <h1>Settings</h1>
      <div className="sub">Provider configuration — the key never leaves the server.</div>
      {s&&<>
        <div className="kv" style={{marginBottom:10}}>
          Model <b>{s.model}</b> · key {s.hasKey?`configured${s.keyFromEnv?' (from env)':''}`:'<b>missing</b>'}
        </div>
        {!s.keyFromEnv&&<div className="row" style={{marginBottom:12}}>
          <input type="password" placeholder="TYPESAFE_API_KEY" value={key}
            onChange={e=>setKey(e.target.value)} style={{flex:1}}/>
          <button onClick={()=>save({apiKey:key})}>Save key</button>
        </div>}
        <div className="row" style={{marginBottom:14}}>
          <span className="kv">Provider mode:</span>
          <select value={s.providerMode} onChange={e=>save({providerMode:e.target.value})}>
            <option value="live">live (calls api.typesafe.ai)</option>
            <option value="fixture">fixture (synthetic, no credits)</option>
          </select>
          {saved&&<span className="badge live">saved</span>}
        </div>
        <div className="dim" style={{fontSize:12}}>
          Fixture mode generates deterministic synthetic music for development — no API credits spent.
          Live mode spends TypeSafe credits: roughly one request per musical event.
        </div>
      </>}
      <div className="row" style={{marginTop:18,justifyContent:'flex-end'}}>
        <button className="primary" onClick={onClose}>Done</button>
      </div>
    </div>
  </div>;
}
