import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { acessoTarefa } from "@/lib/equipe-compartilhado";
import { UUID_RE } from "@/lib/hub";
import { mudarAreaNoNotion } from "@/lib/notion-sync";
import { ErroDoNotion } from "@/lib/notion-api";
import { statusDoNotion } from "@/lib/notion-mapa";
import { gravarSituacaoNoNotion, ligadaAoNotion, situacoesDoNotion, textoDaPaginaNoNotion } from "@/lib/notion-tela";
import { withTenant } from "@/lib/db";
import { mudarTarefa } from "@/lib/tarefa-mudar";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const AREAS = ["Trips", "Weddings", "Corp", "Institucional"];

const SEM_ACESSO = () => NextResponse.json({ error: "Essa ação não existe mais ou não está com você." }, { status: 404 });
const SEM_LIGACAO = () => NextResponse.json({ error: "Essa ação não está no Notion do marketing." }, { status: 400 });

// O texto escrito dentro da página no Notion (só para ler na ação). Quem vê a ação lê.
export const GET = withAuth<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id) || !(await acessoTarefa(user.id, id))) return SEM_ACESSO();
  try {
    const r = await textoDaPaginaNoNotion(id);
    return r ? NextResponse.json(r) : SEM_LIGACAO();
  } catch (e) {
    if (e instanceof ErroDoNotion) return NextResponse.json({ error: "O Notion não respondeu agora. Tente de novo." }, { status: 502 });
    throw e;
  }
});

// A área (BU) ou a situação (pelo nome de lá: Not started, Up next, This Week, Daily, To Day,
// In Approval, Locked, Done) da ação no Notion do marketing. Quem vê a ação muda (como os outros
// campos dela). Corpo: { bu } ou { status_notion }.
export const PATCH = withAuth<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => null)) as { bu?: unknown; status_notion?: unknown } | null;
  const acesso = UUID_RE.test(id) ? await acessoTarefa(user.id, id) : null;
  if (!acesso) return SEM_ACESSO();

  if (b?.status_notion !== undefined) {
    const pedido = typeof b.status_notion === "string" ? b.status_notion.trim().toLowerCase() : "";
    try {
      if (!(await ligadaAoNotion(id))) return SEM_LIGACAO();
      // Só um nome que existe na coluna Status de lá (com a grafia de lá).
      const nome = (await situacoesDoNotion()).find((n) => n.toLowerCase() === pedido);
      if (!nome) return NextResponse.json({ error: "Essa situação não existe no Notion do marketing." }, { status: 400 });
      // A situação do Ações primeiro (com o histórico e a regra de quem pode); depois o nome exato lá.
      const status = statusDoNotion(nome);
      const agora = await withTenant(acesso.donoId, (c) => c.query<{ status: string }>(`SELECT status FROM tarefas WHERE id = $1`, [id]));
      if (agora.rows[0] && agora.rows[0].status !== status) {
        const mudou = await mudarTarefa(user, id, { status });
        if (mudou.status !== 200) return NextResponse.json(mudou.json, { status: mudou.status });
      }
      if (!(await gravarSituacaoNoNotion(id, nome))) return SEM_LIGACAO();
      return NextResponse.json({ ok: true, status_notion: nome, status });
    } catch (e) {
      if (e instanceof ErroDoNotion) return NextResponse.json({ error: "O Notion não aceitou a mudança. Tente de novo." }, { status: 502 });
      throw e;
    }
  }

  const bu = typeof b?.bu === "string" ? b.bu.trim() : "";
  if (!AREAS.includes(bu)) return NextResponse.json({ error: "Escolha Trips, Weddings, Corp ou Institucional." }, { status: 400 });
  try {
    const r = await mudarAreaNoNotion(id, bu);
    if (r === "sem_ligacao") return SEM_LIGACAO();
    return NextResponse.json({ ok: true, bu });
  } catch (e) {
    if (e instanceof ErroDoNotion) return NextResponse.json({ error: "O Notion não aceitou a mudança. Tente de novo." }, { status: 502 });
    throw e;
  }
});
