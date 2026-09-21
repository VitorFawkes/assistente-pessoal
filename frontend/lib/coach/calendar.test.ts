import { describe, expect, test } from "bun:test";
import { createCalendarAccess, defaultCalendarRange, validateCalendarSnapshot, type CalendarRepository, type CalendarRow } from "./calendar";

const owner="7740e829-9462-416b-81a1-b787e23ba9b2";
const range={from:"2026-09-20T00:00:00.000Z",to:"2026-09-27T00:00:00.000Z"};
const now=Date.parse("2026-09-20T14:00:00.000Z");
const snapshot={version:1,status:"connected",...range,updated_at:new Date(now).toISOString(),limitations:[],events:[{id:"evt-1",subject:"Alinhamento",start:"2026-09-20T15:00:00Z",end:"2026-09-20T16:00:00Z",is_all_day:false,is_private:false,show_as:"busy"}]};
function fixture(){
 let row:CalendarRow|null=null;let profileEnabled=true;let revision=1;let calls=0;let fail=false;let unblock:(()=>void)|undefined;let syncOverride:unknown;let readOverride:unknown;
 const repo:CalendarRepository={
  async read(){return {row,profileEnabled,revision};},
  async claim(_user,_range,token){if(!profileEnabled||row?.enabled===false||row?.lease_token)return null;row={enabled:true,lease_token:token,lease_until:new Date(now+60000).toISOString(),attempted_at:new Date(now).toISOString(),snapshot:row?.snapshot??null,error_status:null};return revision;},
  async save(_user,token,expected,result,error){if(row?.lease_token!==token||revision!==expected||!profileEnabled)return false;row={...row,lease_token:null,lease_until:null,snapshot:result,error_status:error};return true;},
  async setEnabled(_user,enabled){row={enabled,lease_token:null,lease_until:null,attempted_at:null,snapshot:null,error_status:null};revision++;},
  async clear(){row=null;revision++;},
 };
 const access=createCalendarAccess(repo,{config:()=>({baseUrl:"https://example.supabase.co/functions/v1",token:"server-secret",userId:owner}),now:()=>now,fetch:async (url,init)=>{calls++;expect(init?.redirect).toBe("error");expect(init?.headers).toEqual({Authorization:"Bearer server-secret","Content-Type":"application/json"});expect(String(url)).not.toContain(owner);if(unblock)await new Promise<void>(resolve=>{unblock=resolve;});if(fail)throw new Error("sensitive upstream failure");return Response.json(String(url).includes("coach-calendar-sync")?(syncOverride??{...snapshot,events:undefined}):(readOverride??snapshot));}});
 return {access,repo,get calls(){return calls;},get row(){return row;},syncResult(value:unknown){syncOverride=value;},readResult(value:unknown){readOverride=value;},pauseProfile(){profileEnabled=false;revision++;},fail(){fail=true;},async erase(){await repo.clear(owner);},setStale(){row={...row!,snapshot:{...snapshot,status:"connected",updated_at:"2026-09-19T10:00:00Z"}} as CalendarRow;},block(){unblock=()=>{};},release(){const release=unblock;unblock=undefined;release?.();}};
}
describe("private TTARS agenda",()=>{
 test.each([
  {name:"late evening in Sao Paulo",at:"2026-09-21T02:00:00Z",timezone:"America/Sao_Paulo",from:"2026-09-19T03:00:00.000Z",to:"2026-09-28T03:00:00.000Z"},
  {name:"the next local day in UTC+14",at:"2026-09-20T12:00:00Z",timezone:"Pacific/Kiritimati",from:"2026-09-19T10:00:00.000Z",to:"2026-09-28T10:00:00.000Z"},
  {name:"spring daylight saving transition",at:"2026-03-07T12:00:00Z",timezone:"America/New_York",from:"2026-03-06T05:00:00.000Z",to:"2026-03-15T04:00:00.000Z"},
  {name:"autumn daylight saving transition",at:"2026-10-31T12:00:00Z",timezone:"America/New_York",from:"2026-10-30T04:00:00.000Z",to:"2026-11-08T05:00:00.000Z"},
  {name:"a skipped local midnight at the exclusive end",at:"2018-10-27T12:00:00Z",timezone:"America/Sao_Paulo",from:"2018-10-26T03:00:00.000Z",to:"2018-11-04T03:00:00.000Z"},
 ])("default window covers complete local days: $name",({at,timezone,from,to})=>{
  expect(defaultCalendarRange(Date.parse(at),timezone)).toEqual({from,to});
 });
 test("default window falls back to the usual timezone when the supplied zone is invalid",()=>{
  expect(defaultCalendarRange(Date.parse("2026-09-21T02:00:00Z"),"invalid/zone")).toEqual({from:"2026-09-19T03:00:00.000Z",to:"2026-09-28T03:00:00.000Z"});
 });
 test("context uses the profile timezone when no explicit range is requested",async()=>{
  const f=fixture();
  const localRange={from:"2026-09-18T15:00:00.000Z",to:"2026-09-27T15:00:00.000Z"};
  f.syncResult({...snapshot,...localRange,events:undefined});f.readResult({...snapshot,...localRange});
  const result=await f.access.context(owner,undefined,{timezone:"Asia/Tokyo"});
  expect(result.status).toBe("connected");expect({from:result.from,to:result.to}).toEqual(localRange);
 });
 test("other users cannot query or learn whether the configured owner is connected",async()=>{const f=fixture();const result=await f.access.context("other",range);expect(result.status).toBe("not_configured");expect(result.events).toEqual([]);expect(f.calls).toBe(0);});
 test("sync then prepared read, without Microsoft credentials, and reuse fresh cache",async()=>{const f=fixture();const result=await f.access.context(owner,range);expect(result.events[0].subject).toBe("Alinhamento");expect(result.planned_only).toBe(true);expect(result.status).toBe("connected");expect(f.calls).toBe(2);await f.access.context(owner,range);await f.access.status(owner);expect(f.calls).toBe(2);});
 test("paused profile and paused calendar never fetch",async()=>{const f=fixture();f.pauseProfile();expect((await f.access.context(owner,range)).status).toBe("paused");expect(f.calls).toBe(0);const g=fixture();await g.access.setEnabled(owner,false);expect((await g.access.context(owner,range)).status).toBe("paused");expect(g.calls).toBe(0);});
 test("failure exposes unavailability, never a fabricated free day or upstream detail",async()=>{const f=fixture();f.fail();const result=await f.access.context(owner,range);expect(result.status).toBe("unavailable");expect(result.events).toEqual([]);expect(result.limitations.join()).not.toContain("sensitive");await f.access.context(owner,range);expect(f.calls).toBe(1);});
 test("stale snapshots are not used as current agenda after refresh fails",async()=>{const f=fixture();await f.access.context(owner,range);f.setStale();f.fail();const result=await f.access.context(owner,range,{force:true});expect(result.status).toBe("unavailable");expect(result.events).toEqual([]);});
 test("concurrent requests share one sync; reset rejects the pending result",async()=>{const f=fixture();f.block();const first=f.access.context(owner,range);await new Promise(resolve=>setTimeout(resolve,5));const second=await f.access.context(owner,range);expect(second.events).toEqual([]);expect(f.calls).toBe(1);await f.erase();f.release();expect((await first).events).toEqual([]);expect(f.row).toBeNull();});
 test("bounded ISO ranges and strict bridge shape reject incomplete data",()=>{expect(()=>validateCalendarSnapshot({...snapshot,to:range.from},range,now)).toThrow();expect(()=>validateCalendarSnapshot({...snapshot,events:[{...snapshot.events[0],end:"invalid"}]},range,now)).toThrow();expect(()=>validateCalendarSnapshot({...snapshot,updated_at:"2026-09-20T15:00:00Z"},range,now)).toThrow();expect(()=>validateCalendarSnapshot({...snapshot,events:new Array(1001).fill(snapshot.events[0])},range,now)).toThrow();});
 test("reconnect without generation preserves status and translates machine limitations",()=>{const result=validateCalendarSnapshot({...snapshot,status:"needs_reconnect",updated_at:null,events:[],limitations:["microsoft_reconnection_required","default_microsoft_calendar_only"]},range,now);expect(result.status).toBe("needs_reconnect");expect(result.updated_at).toBeNull();expect(result.limitations.join()).toContain("Reconecte");expect(result.limitations.join()).toContain("Mac");expect(result.limitations.join()).not.toContain("_only");});
 test("a quarterly coaching question continues without pretending to have that whole agenda",async()=>{const f=fixture();const result=await f.access.context(owner,{from:"2026-07-01T00:00:00Z",to:"2026-10-01T00:00:00Z"});expect(result.status).toBe("unavailable");expect(result.limitations.join()).toContain("31 dias");expect(f.calls).toBe(0);});
 test("HTTP 200 sync failure or revocation cannot reuse a previous prepared snapshot",async()=>{for(const status of ["unavailable","needs_reconnect"] as const){const f=fixture();await f.access.context(owner,range);f.syncResult({...snapshot,status,updated_at:null,events:undefined});const result=await f.access.context(owner,range,{force:true});expect(result.status).toBe(status);expect(result.events).toEqual([]);expect(f.calls).toBe(3);}});
 test("prepared generation must be the same one just captured",async()=>{const f=fixture();f.readResult({...snapshot,updated_at:new Date(now-60000).toISOString()});expect((await f.access.context(owner,range)).status).toBe("unavailable");expect(f.row?.snapshot).toBeNull();});
 test("all-day events do not become an invented 21:00 appointment after timezone conversion",async()=>{const f=fixture();f.readResult({...snapshot,events:[{...snapshot.events[0],is_all_day:true,start:"2026-09-21T00:00:00Z",end:"2026-09-22T00:00:00Z"}]});const result=await f.access.context(owner,range,{timezone:"America/Sao_Paulo"});expect(result.events[0].start_local).toContain("Dia inteiro");expect(result.events[0].start_local).not.toContain("21:00");});
});
