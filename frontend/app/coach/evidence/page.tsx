import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserOrRedirect } from "@/lib/auth";
import { coachStore } from "@/lib/coach/store";
import { chunkMeeting, sourceHash } from "@/lib/coach/evidence";
export const dynamic="force-dynamic";
export default async function EvidencePage({searchParams}:{searchParams:Promise<{meeting?:string;chunk?:string;hash?:string}>}){
 const user=await requireUserOrRedirect();const params=await searchParams;
 if(!params.meeting||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.meeting))notFound();
 const meeting=await coachStore(user.id).meetingById(params.meeting);if(!meeting)notFound();
 const chunks=chunkMeeting(meeting);const index=Number(params.chunk||0);if(!Number.isInteger(index)||index<0||!chunks[index])notFound();
 const changed=params.hash!==sourceHash(meeting);
 return <article className="min-w-0"><Link href="/coach" className="text-sm underline">Voltar ao coach</Link><h1 className="font-display text-3xl mt-6 mb-3 break-words">{meeting.nome||meeting.original_filename}</h1><p className="text-sm mb-4">Parte {index+1} de {chunks.length}. Esta é a transcrição atual usada como fonte.</p>{changed&&<p role="status" className="rounded-xl border p-4 mb-5">A transcrição ou a identificação dos participantes mudou desde esta avaliação. A interpretação anterior precisa ser reavaliada.</p>}<Link className="underline text-sm" href={`/reunioes/${meeting.id}`}>Abrir reunião e áudio</Link><pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7 mt-6 p-5 rounded-2xl border bg-[var(--card)]">{chunks[index].text}</pre></article>;
}
