import { timingSafeEqual } from "node:crypto";
import { query } from "@/lib/db";
import { finalizarGravacao } from "@/lib/gravacao-final";

// Gravação sem áudio novo há 10 min (aba fechada, notebook dormiu, internet caiu) vira reunião.
const MINUTOS_SEM_AUDIO = 10;

function autorizado(req: Request): boolean {
  const esperado = Buffer.from(process.env.WEBHOOK_TOKEN || "");
  const recebido = Buffer.from(req.headers.get("x-webhook-token") || "");
  return esperado.length > 0 && recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

export const POST = async (req: Request) => {
  if (!autorizado(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const paradas = await query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM gravacao_sessoes
     WHERE finalizada_em IS NULL AND last_chunk_at < now() - make_interval(mins := $1)`,
    [MINUTOS_SEM_AUDIO],
  );
  let enviadas = 0;
  const falhas: string[] = [];
  for (const g of paradas) {
    try {
      await finalizarGravacao(g.user_id, g.id);
      enviadas++;
    } catch (err) {
      console.error("varrer gravacao", g.id, err);
      falhas.push(g.id);
    }
  }
  return Response.json({ encontradas: paradas.length, enviadas, falhas });
};
