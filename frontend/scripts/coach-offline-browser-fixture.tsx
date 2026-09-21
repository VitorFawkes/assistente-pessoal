// Synthetic offline browser fixture: never connects to APIs or a database.
import React from "react";
import { createRoot } from "react-dom/client";
import { CoachDashboard } from "../components/coach/dashboard";
import type { CalendarStatus } from "../lib/coach/calendar-types";
import type { CoachJob } from "../lib/coach/jobs";
import type { CoachProfile, CoachState, Coverage } from "../lib/coach/types";
const now=new Date().toISOString();
type FixtureState=CoachState&{calendar:CalendarStatus;jobs:CoachJob[]};
type FixtureWindow=Window&typeof globalThis&{__fixture:{calls:Record<string,unknown>[];state:()=>FixtureState;remount:()=>void;setCoverage:(coverage:Partial<Coverage>)=>void}};
let state:FixtureState={
 profile:{user_id:"synthetic-offline",enabled:true,weekly_enabled:true,morning_enabled:false,evening_enabled:false,nudges_enabled:false,morning_hour:8,evening_hour:18,goals:"Prioridade fictícia",context:"Contexto fictício",timezone:"America/Sao_Paulo",review_day:5,review_hour:17,revision:1,last_run_at:null,last_error:null,created_at:now,updated_at:now},
 calendar:{configured:true,enabled:true,status:"connected",updated_at:now,from:null,to:null,limitations:[]},
 memories:[],messages:[],reviews:[],jobs:[],coverage:{total_meetings:2,report_ready_meetings:2,executive_report_meetings:1,summary_only_meetings:1,missing_report_meetings:0,pending_meetings:0,analyzed_meetings:0,analyzed_chunks:0},model_available:true
};
const calls:Record<string,unknown>[]=[];
const offlineFetch=async(input:RequestInfo|URL,init:RequestInit={})=>{
 if(String(input)!=="/api/coach")throw Error("Offline fixture refuses external requests");
 const body=init.body?JSON.parse(String(init.body)) as Record<string,unknown>:null;
 calls.push(body||{action:"read"});
 if(body?.action==="calendar_settings"){const enabled=body.enabled===true;state.calendar={...state.calendar,enabled,status:enabled?"not_synced":"paused",updated_at:null};state.profile={...state.profile,revision:state.profile.revision+1};}
 if(body?.action==="settings"){const profile={...body};Reflect.deleteProperty(profile,"action");state.profile={...state.profile,...profile,revision:state.profile.revision+1} as CoachProfile;}
 return new Response(JSON.stringify(state),{status:200,headers:{"content-type":"application/json"}});
};
window.fetch=Object.assign(offlineFetch,{preconnect:()=>{}}) as typeof fetch;
let root=createRoot(document.getElementById("root")!);
(window as FixtureWindow).__fixture={calls,state:()=>state,remount(){root.unmount();root=createRoot(document.getElementById("root")!);root.render(<CoachDashboard/>);},setCoverage(coverage){state={...state,coverage:{...state.coverage,...coverage}};}};
root.render(<CoachDashboard/>);
