import { PROTOCOL_VERSION, type ClientCommandType, type Envelope } from '../../../daemon/src/protocol';
import type { ConnectionState } from './types';
type WebSocketLike={readyState:number; send(data:string):void; close():void; onopen:((e:Event)=>void)|null; onmessage:((e:MessageEvent)=>void)|null; onclose:((e:CloseEvent)=>void)|null; onerror:((e:Event)=>void)|null};
type Pending={resolve:(v:unknown)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>};
const id=()=>globalThis.crypto?.randomUUID?.() ?? `c_${Date.now()}_${Math.random().toString(36).slice(2)}`;
export function daemonUrl():string { const u=new URL(window.location.href); return u.searchParams.get('daemon') ?? localStorage.getItem('omp-webui.daemon') ?? `${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`; }
export function daemonHealthUrl(): string {
  const ws = new URL(daemonUrl());
  ws.protocol = ws.protocol === 'wss:' ? 'https:' : 'http:';
  ws.pathname = '/api/health';
  ws.search = '';
  return ws.toString();
}
export class DaemonClient { private ws?:WebSocketLike; private pending=new Map<string,Pending>(); private handlers=new Set<(e:Envelope)=>void>(); private stateHandlers=new Set<(s:ConnectionState)=>void>(); private retries=0; private stopped=false; private reconnectTimer?:ReturnType<typeof setTimeout>; private sequences=new Map<string,number>(); private active?:{sessionId:string;sessionFile?:string}; constructor(private url=daemonUrl(),private factory:(url:string)=>WebSocketLike=(url)=>new WebSocket(url)){ }
 get connectionState():ConnectionState{return this.ws?.readyState===1?'online':this.retries?'reconnecting':'offline'}; onEvent(handler:(e:Envelope)=>void){this.handlers.add(handler);return()=>this.handlers.delete(handler)}; onState(handler:(s:ConnectionState)=>void){this.stateHandlers.add(handler);return()=>this.stateHandlers.delete(handler)}; private announce(s:ConnectionState){this.stateHandlers.forEach(h=>h(s))}; connect(){if(this.ws && (this.ws.readyState===0||this.ws.readyState===1))return;this.stopped=false;this.announce(this.retries?'reconnecting':'connecting'); const ws=this.ws=this.factory(this.url);ws.onopen=()=>{this.retries=0;this.announce('online');if(this.active)this.command('connection.resume',{sessionId:this.active.sessionId,afterSequence:this.sequences.get(this.active.sessionId)??0},this.active.sessionId).catch(()=>{});};ws.onmessage=(msg)=>this.receive(msg.data);ws.onerror=()=>undefined;ws.onclose=()=>{if(this.ws===ws)this.ws=undefined;if(!this.stopped)this.schedule();};}
 disconnect(){this.stopped=true;clearTimeout(this.reconnectTimer);this.ws?.close();this.ws=undefined;this.announce('offline');for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Connection closed'));}this.pending.clear();}
 setActiveSession(session?:{sessionId:string;sessionFile?:string}){this.active=session;}
 private schedule(){this.retries++;this.announce('reconnecting');const cap=Math.min(8000,250*2**(this.retries-1));const delay=Math.round(cap*(0.75+Math.random()*0.5));this.reconnectTimer=setTimeout(()=>this.connect(),delay);}
 private receive(raw:unknown){let e:Envelope;try{e=JSON.parse(String(raw))}catch{return}if(e.sessionId&&typeof e.sequence==='number')this.sequences.set(e.sessionId,Math.max(this.sequences.get(e.sessionId)??0,e.sequence));if(e.type==='response'&&e.correlationId){const p=this.pending.get(e.correlationId);if(p){this.pending.delete(e.correlationId);clearTimeout(p.timer);e.error?p.reject(new Error(e.error.message)):p.resolve(e.payload);}}this.handlers.forEach(h=>h(e));}
 command<T=unknown>(type:ClientCommandType,payload?:unknown,sessionId?:string):Promise<T>{if(!this.ws||this.ws.readyState!==1)return Promise.reject(new Error('Local agent is not connected'));const commandId=id();const frame={protocolVersion:PROTOCOL_VERSION,type,id:commandId,...(sessionId?{sessionId}:{}),...(payload===undefined?{}:{payload})};return new Promise<T>((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(commandId);reject(new Error(`${type} timed out`));},30000);this.pending.set(commandId,{resolve:resolve as (x:unknown)=>void,reject,timer});this.ws!.send(JSON.stringify(frame));});}
}
export const daemonClient=new DaemonClient();
