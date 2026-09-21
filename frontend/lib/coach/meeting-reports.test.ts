import { expect, test } from "bun:test";
import { meetingReport, reportContextHash, reportPeriodFingerprint, buildMeetingReports, transcriptFallbackMeetings, reportSources, reportLineage } from "./meeting-reports";
import { buildSourceBank } from "./investigation";
import { chunkMeeting } from "./evidence";
import type { CoachMeeting } from "./types";
const meeting:CoachMeeting={id:"a",nome:"Diretoria",original_filename:"a.mp3",recorded_at:"2026-09-18T12:00:00Z",transcription:"Vamos examinar os próximos passos.",segments:[],speaker_labels:{},speaker_pessoas:{},summary:"Contexto curto",executive_summary:"## Decisões\nAna prepara a proposta."};
test("executive report is primary generated context, never a verbatim behavioral source",()=>{
 expect(meetingReport(meeting)).toMatchObject({kind:"executive_summary",text:meeting.executive_summary,generated:true,behavioral_evidence:false});
 expect(buildSourceBank([{meeting,chunk:chunkMeeting(meeting)[0]}],[])).toEqual({});
 expect(transcriptFallbackMeetings([meeting])).toEqual([]);
});
test("short summary is explicit fallback and absent reports preserve the meeting",()=>{
 expect(meetingReport({...meeting,executive_summary:" "}).kind).toBe("summary");
 const absent={...meeting,executive_summary:null,summary:null};
 expect(meetingReport(absent).kind).toBe("missing");
 expect(transcriptFallbackMeetings([absent])).toEqual([absent]);
 expect(buildMeetingReports([absent]).meetings[0]).toMatchObject({meeting_id:"a",kind:"missing",report:null});
});
test("context version changes with report, source, attribution, title or date but not ordering",()=>{
 for(const patch of [{executive_summary:"Nova decisão"},{summary:"Novo resumo"},{transcription:"Corrigida"},{speaker_pessoas:{A:"p"}},{nome:"Título novo"},{recorded_at:"2026-09-19T12:00:00Z"}])
  expect(reportContextHash({...meeting,...patch})).not.toBe(reportContextHash(meeting));
 const other={...meeting,id:"b"};
 expect(reportPeriodFingerprint([meeting,other])).toBe(reportPeriodFingerprint([other,meeting]));
 expect(reportPeriodFingerprint([meeting])).not.toBe(reportPeriodFingerprint([meeting,other]));
});
test("bounded reports include every meeting and explicitly mark text truncation",()=>{
 const many=Array.from({length:30},(_,i)=>({...meeting,id:String(i),executive_summary:"x".repeat(10000)}));
 const context=buildMeetingReports(many,12000);
 expect(context.meetings).toHaveLength(30);
 expect(context.meetings.reduce((n,m)=>n+(m.report?.length||0),0)).toBeLessThanOrEqual(12000);
 expect(context.meetings.every(m=>m.truncated)).toBe(true);
 expect(context.limitations.join(" ")).toContain("30");
});

test("mixed versions of one report remain visible to the transactional stale guard",()=>{
 const references=reportSources([meeting,meeting,{...meeting,executive_summary:"Editado durante a resposta"}]);
 expect(references).toHaveLength(2);expect(references[0].context_hash).not.toBe(references[1].context_hash);
});


test("inherited lineage preserves conflicting versions so persistence cannot bless mixed context",()=>{
 const period={from:"1999-01-01T00:00:00Z",to:"1999-01-08T00:00:00Z",fingerprint:"before"};
 const source={meeting_id:"historical",context_hash:"before"};
 const lineage=reportLineage([{context_sources:[source],report_context:period},{context_sources:[source,{...source,context_hash:"after"}],context_periods:[period,{...period,fingerprint:"after"}]}]);
 expect(lineage.sources).toEqual([source,{...source,context_hash:"after"}]);
 expect(lineage.periods).toEqual([period,{...period,fingerprint:"after"}]);
});
