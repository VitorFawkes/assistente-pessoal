import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { conversar, type Contexto, type Fala, type Rastro } from "@/lib/agente";
import { guardarConversa } from "@/lib/agente-conversas";
import { IaIndisponivel } from "@/lib/ia";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

// Assistente do Ações nas telas do TTARS. Corpo: { falas: [{quem, texto, acoes?}], contexto?: {tela, projeto_id,
// reuniao_id, reuniao_aberta, pessoa_email, tarefa_id, time_id, objetivo_id, lugar}, workspace? }. A conversa mora no navegador.
export const POST = withAuth(async (user, req) => {
  const body = (await req.json().catch(() => null)) as {
    falas?: Fala[];
    contexto?: Contexto;
    workspace?: string;
  } | null;
  if (!body || !Array.isArray(body.falas)) {
    return NextResponse.json({ error: "Escreva uma pergunta." }, { status: 400 });
  }
  const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const c = body.contexto ?? {};
  const comeco = Date.now();
  const rastro: Rastro = { ferramentas: [] };
  const ultima = [...body.falas].reverse().find((f) => f?.quem === "pessoa");
  const registro = {
    quando: new Date().toISOString(),
    user_id: user.id,
    nome: user.nome,
    tela: txt(c.tela),
    lugar: txt(c.lugar),
    pergunta: typeof ultima?.texto === "string" ? ultima.texto.slice(0, 2000) : null,
    falas_antes: Math.max(0, body.falas.length - 1),
  };
  try {
    const r = await conversar(user, req, {
      falas: body.falas,
      contexto: {
        tela: txt(c.tela),
        projeto_id: txt(c.projeto_id),
        // reuniao_id só vem na reunião de quem gravou (a caixa "Nova ação" usa); reuniao_aberta, em qualquer uma.
        reuniao_id: txt(c.reuniao_id) ?? txt((c as { reuniao_aberta?: unknown }).reuniao_aberta),
        pessoa_email: txt(c.pessoa_email),
        tarefa_id: txt(c.tarefa_id),
        time_id: txt(c.time_id),
        objetivo_id: txt(c.objetivo_id),
        lugar: txt(c.lugar),
      },
      workspace: txt(body.workspace),
    }, rastro);
    void guardarConversa({
      ...registro,
      ferramentas: rastro.ferramentas,
      resposta: r.texto.slice(0, 4000),
      citadas: r.citadas.length,
      feitas: r.feitas.map((f) => f.descricao),
      propostas: r.propostas.map((p) => p.descricao),
      custo_usd: r.custo_usd,
      segundos: Number(((Date.now() - comeco) / 1000).toFixed(1)),
    });
    return NextResponse.json(r);
  } catch (e) {
    void guardarConversa({
      ...registro,
      ferramentas: rastro.ferramentas,
      erro: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300),
      segundos: Number(((Date.now() - comeco) / 1000).toFixed(1)),
    });
    if (e instanceof IaIndisponivel) return NextResponse.json({ error: e.message }, { status: 503 });
    console.error("[agente]", e);
    return NextResponse.json({ error: "O Assistente não conseguiu responder agora. Tente de novo." }, { status: 500 });
  }
});
