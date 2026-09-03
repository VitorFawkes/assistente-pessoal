import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { clientIp } from "@/lib/rate-limit";
import { acessoPorTokenOuNull } from "@/lib/reuniao-guest";
import { meetingsFor } from "@/lib/queries";
import { MeetingPrintSheet, parsePrintParams } from "@/components/meeting-print";
import type { MeetingExportRow } from "@/lib/meeting-export";
import { PrintTrigger } from "@/app/reunioes/[id]/imprimir/print-trigger";

export const dynamic = "force-dynamic";

export default async function ImprimirCompartilhadaPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ content?: string; scope?: string; section?: string }>;
}) {
  const { token } = await params;
  const { content, section } = parsePrintParams(await searchParams);

  const acesso = await acessoPorTokenOuNull(token, clientIp(await headers()));
  if (!acesso) notFound();

  const m = (await meetingsFor(acesso.ownerId).forExport(
    acesso.meetingId,
  )) as MeetingExportRow | null;
  if (!m) notFound();

  return (
    <>
      <MeetingPrintSheet meeting={m} content={content} section={section} />
      <PrintTrigger />
    </>
  );
}
