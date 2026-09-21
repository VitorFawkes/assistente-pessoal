import { createHash } from "node:crypto";
import { sourceHash } from "./evidence";
import type { CoachMeeting, ReportSource, ReportPeriodSource } from "./types";

/** Existing pipeline reports are secondary context, never an evidence/citation bank. */
export function meetingReport(meeting:CoachMeeting){
 const executive=meeting.executive_summary?.trim();const summary=meeting.summary?.trim();
 return {kind:executive?"executive_summary" as const:summary?"summary" as const:"missing" as const,
  text:executive||summary||null,generated:true as const,behavioral_evidence:false as const};
}
export function reportContextHash(meeting:CoachMeeting){
 return createHash("sha256").update(JSON.stringify(["report-context-v1",meeting.id,meeting.nome,meeting.original_filename,meeting.summary??null,meeting.executive_summary??null,sourceHash(meeting)])).digest("hex");
}
export function reportSources(meetings:CoachMeeting[]):ReportSource[]{
 const references=meetings.map(meeting=>({meeting_id:meeting.id,context_hash:reportContextHash(meeting)}));
 // Conflicting versions survive so the transactional save rejects a mixed-version response.
 return [...new Map(references.map(reference=>[reference.meeting_id+":"+reference.context_hash,reference])).values()];
}
/** Preserve transitive dependencies, including empty periods and conflicting versions. */
export function reportLineage(contexts:{context_sources?:ReportSource[];context_periods?:ReportPeriodSource[];report_context?:ReportPeriodSource}[]){
 const sources=contexts.flatMap(context=>context.context_sources||[]);
 const periods=contexts.flatMap(context=>[...(context.context_periods||[]),...(context.report_context?[context.report_context]:[])]);
 return {sources:[...new Map(sources.map(source=>[JSON.stringify([source.meeting_id,source.context_hash]),source])).values()],
  periods:[...new Map(periods.map(period=>[JSON.stringify([period.from,period.to,period.fingerprint]),period])).values()]};
}
export function reportPeriodFingerprint(meetings:CoachMeeting[]){
 return createHash("sha256").update(JSON.stringify(reportSources(meetings).sort((a,b)=>a.meeting_id.localeCompare(b.meeting_id)))).digest("hex");
}
export function transcriptFallbackMeetings(meetings:CoachMeeting[]){return meetings.filter(meeting=>meetingReport(meeting).kind==="missing");}

/** Divide the text budget across ALL meetings; large periods never silently lose a meeting. */
export function buildMeetingReports(meetings:CoachMeeting[],maxCharacters=72000){
 const count=meetings.filter(meeting=>meetingReport(meeting).text).length;
 const budget=Math.max(0,Math.min(16000,Math.floor(maxCharacters/Math.max(1,count))));
 const reports=meetings.map(meeting=>{
  const report=meetingReport(meeting);const context=meeting as CoachMeeting&{context_at?:string;date_basis?:string};
  return {meeting_id:meeting.id,title:meeting.nome||meeting.original_filename,recorded_at:meeting.recorded_at,context_at:context.context_at,date_basis:context.date_basis,
   kind:report.kind,report:report.text?.slice(0,budget)||null,generated:true,behavioral_evidence:false,context_hash:reportContextHash(meeting),
   truncated:!!report.text&&report.text.length>budget,original_characters:report.text?.length||0};
 });
 const truncated=reports.filter(report=>report.truncated).length;const missing=reports.filter(report=>report.kind==="missing").length;const short=reports.filter(report=>report.kind==="summary").length;
 return {meetings:reports,limitations:[
  `${reports.length} reuniões representadas por seus relatórios/resumos existentes; são contexto gerado, não transcrições nem prova de conduta pessoal.`,
  ...(truncated?[`${truncated} relatórios têm texto parcial neste contexto; use read_meeting_report para consultar o restante antes de concluir sobre uma omissão.`]:[]),
  ...(short?[`${short} reuniões têm apenas resumo curto; decisões, responsáveis ou nuances podem estar ausentes.`]:[]),
  ...(missing?[`${missing} reuniões ainda não têm relatório ou resumo; continuam identificadas e suas transcrições podem ser consultadas quando necessário.`]:[]),
 ]};
}
