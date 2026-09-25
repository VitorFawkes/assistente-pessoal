import { timingSafeEqual } from "node:crypto";
import { sincronizar } from "@/lib/notion-sync";

// Chamada a cada minuto pelo cron do servidor: Ações ↔ Notion do marketing.
function autorizado(req: Request): boolean {
  const esperado = Buffer.from(process.env.WEBHOOK_TOKEN || "");
  const recebido = Buffer.from(req.headers.get("x-webhook-token") || "");
  return esperado.length > 0 && recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

export const POST = async (req: Request) => {
  if (!autorizado(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await sincronizar());
};
