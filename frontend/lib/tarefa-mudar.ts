// Mudar uma tarefa: a regra única do Ações da equipe. A tela (PATCH /api/tarefas/[id]) e o Coach usam
// estas funções, então quem pode mudar o quê, o histórico e a tarefa passada a colega são iguais nos dois.
// Separada em conferir (prepararMudanca) e gravar (gravarMudanca, dentro de uma transação no tenant do dono)
// para o Coach gravar um lote inteiro de uma vez: ou muda tudo, ou nada.
import type { PoolClient } from "pg";
import type { User } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { getOwnerSlug } from "@/lib/owner-slug";
import { isTeamMode } from "@/lib/team-mode";
import { resolverDono } from "@/lib/compartilhar";
import {
  acessoTarefa,
  ajustarPrincipal,
  carregarTarefas,
  colegasDe,
  registrarEvento,
  type Papel,
} from "@/lib/equipe-compartilhado";
import { resolverEscolha } from "@/lib/escolha-de-dono";
import { pedirEnvio } from "@/lib/notion-sync";
import { buDoWorkspace } from "@/lib/notion-mapa";
import { podeObjetivo, semObjetivoEscondido } from "@/lib/hub";
import { mexidaDoCorpo, travaDoPedido } from "@/lib/pedidos-trava";
import { recusaDoTimeNaTarefa } from "@/lib/pedidos-publico";

const VALID_STATUS = ["aberta", "em_andamento", "aguardando_aprovacao", "concluida", "cancelada"] as const;
const VALID_PRIORIDADE = ["baixa", "media", "alta", "urgente"] as const;
const VALID_ACAO = ["executar", "cobrar", "aguardar"] as const;

export type MudancaDeTarefa = Partial<{
  titulo: string;
  descricao: string | null;
  owner: string;
  acao: (typeof VALID_ACAO)[number];
  prazo: string | null;
  inicio: string | null;
  prazo_text: string | null;
  prioridade: (typeof VALID_PRIORIDADE)[number];
  status: (typeof VALID_STATUS)[number];
  frente_id: string | null;
  depende_de: string | null;
  area_raw: string | null;
  no_plano: boolean;
  ordem: number | null;
  pessoas: { nome: string; principal?: boolean }[];
  /** Equipe: colega que passa a ser o dono (a tarefa entra na lista dele). */
  responsavel_user_id: string | null;
  /** Equipe: pessoa do TTARS pelo e-mail (ganha conta aqui se ainda não tem) ou "notion:<id>". */
  responsavel_email: string;
  /** Quem faz é alguém de fora da Welcome (fornecedor, cliente), pelo nome: a ação fica com quem criou, para cobrar. */
  quem_nome_fora: string;
  /** Workspace do TTARS de quem pede (área no Notion do marketing). */
  workspace: string;
  /** Hub: ação do time (id do time do TTARS) ou pessoal (null). Só quem criou muda. */
  time_id: string | null;
  /** Hub: objetivo a que a ação serve (um que quem pede enxerga) ou nenhum. */
  objetivo_id: string | null;
}>;

// O que só quem criou a tarefa muda: plano/ordem pessoais dele e o tema (os temas são
// de cada pessoa — um tema de outra conta não aparece pra quem criou).
const SO_DO_CRIADOR = ["no_plano", "ordem", "frente_id", "area_raw"] as const;

// Campos de CONTEÚDO cuja edição manual é sinal de correção (modelo errou → usuário corrigiu).
// Vira evento 'editada' com de→para = dataset de feedback p/ afinar a extração (Fase 4).
const CORRECTION_FIELDS = ["titulo", "descricao", "owner", "acao", "prazo", "prazo_text", "prioridade", "area_raw"] as const;

type Erro = { ok: false; status: number; erro: string };
const erro = (status: number, mensagem: string): Erro => ({ ok: false, status, erro: mensagem });

export type MudancaPreparada = {
  id: string;
  donoId: string;
  papel: Papel;
  body: MudancaDeTarefa;
  sets: string[];
  values: unknown[];
  hasPessoas: boolean;
  notionUserId: string | null;
};

/** Confere se `user` pode fazer a mudança e traduz o pedido para o que se grava (sem gravar nada). */
export async function prepararMudanca(
  user: Pick<User, "id">,
  id: string,
  entrada: MudancaDeTarefa,
): Promise<{ ok: true; preparo: MudancaPreparada } | Erro> {
  const body: MudancaDeTarefa = { ...entrada };
  const acesso = await acessoTarefa(user.id, id);
  if (!acesso) return erro(404, "tarefa não encontrada");
  // Pedido ao marketing: só o marketing muda (quem pediu cancela enquanto não começou).
  const trava = await travaDoPedido(user.id, [id], mexidaDoCorpo(entrada as Record<string, unknown>));
  if (trava) return erro(trava.status, trava.erro);
  const donoId = acesso.donoId;
  if (acesso.papel !== "dono") {
    for (const k of SO_DO_CRIADOR) delete body[k];
  }
  if (body.acao !== undefined && !VALID_ACAO.includes(body.acao)) return erro(400, "acao inválida");

  // Quem faz escolhido na lista das telas do TTARS: pessoa da Welcome (e-mail) ou pessoa que
  // só existe no Notion do marketing ("notion:<id>"). Quem é do marketing manda a ação pro Notion.
  const escolha = await resolverEscolha(body.responsavel_email);
  if (escolha && "erro" in escolha) return erro(400, escolha.erro);
  if (escolha) Object.assign(body, escolha.corpo);
  delete body.responsavel_email;

  // Alguém de fora da Welcome, escolhido na tela: só o nome, mesmo que um colega tenha o mesmo.
  // Só quem criou: para quem recebeu, a ação sairia da lista dele (fica com quem criou, que cobra).
  let deFora = false;
  if (body.quem_nome_fora !== undefined) {
    const nome = typeof body.quem_nome_fora === "string" ? body.quem_nome_fora.replace(/\s+/g, " ").trim().slice(0, 80) : "";
    delete body.quem_nome_fora;
    if (!nome || nome === "?") return erro(400, "Escreva o nome de quem faz.");
    if (escolha) return erro(400, "Escolha uma pessoa só para fazer.");
    if (acesso.papel !== "dono") return erro(403, "Só quem criou a ação passa para alguém de fora da Welcome.");
    body.owner = nome;
    if (body.acao !== "aguardar") body.acao = "cobrar";
    delete body.responsavel_user_id;
    deFora = true;
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  const push = (col: string, val: unknown) => {
    values.push(val);
    sets.push(`${col} = $${values.length}`);
  };

  // Equipe: o dono pode ser um colega (a tarefa vai pra lista dele). Traduz o pedido
  // pro que se grava do ponto de vista de quem criou a tarefa.
  if (
    isTeamMode() &&
    (body.owner !== undefined || body.acao !== undefined || body.responsavel_user_id !== undefined || Array.isArray(body.pessoas))
  ) {
    const r = resolverDono(
      {
        owner: body.owner,
        acao: body.acao,
        responsavel_user_id: body.responsavel_user_id,
        pessoas: Array.isArray(body.pessoas) ? body.pessoas : undefined,
        de_fora: deFora,
      },
      { donoId, colegas: await colegasDe(user.id), slug: getOwnerSlug() },
    );
    if (r.erro) return erro(400, r.erro);
    body.owner = r.owner;
    body.acao = r.acao;
    if (r.pessoas) body.pessoas = r.pessoas;
    if (r.responsavel !== undefined) push("responsavel_user_id", r.responsavel);
  }

  if (body.titulo !== undefined) push("titulo", body.titulo);
  if (body.descricao !== undefined) push("descricao", body.descricao);
  if (body.owner !== undefined) push("owner", body.owner);
  if (body.acao !== undefined) {
    push("acao", body.acao);
    // invariante: executar ⇔ a tarefa é do dono da conta. Sem owner explícito, força o slug.
    if (body.acao === "executar" && body.owner === undefined) push("owner", getOwnerSlug());
  }
  if (body.prazo !== undefined) push("prazo", body.prazo);
  if (body.inicio !== undefined) push("inicio", body.inicio);
  if (body.prazo_text !== undefined) push("prazo_text", body.prazo_text);
  if (body.prioridade !== undefined) {
    if (!VALID_PRIORIDADE.includes(body.prioridade)) return erro(400, "prioridade inválida");
    push("prioridade", body.prioridade);
  }
  if (body.status !== undefined) {
    if (!VALID_STATUS.includes(body.status)) return erro(400, "status inválido");
    push("status", body.status);
    // desde quando está nesta situação — é o "entrou nesta coluna" do quadro
    sets.push("situacao_desde = now()");
    if (body.status === "concluida") sets.push("concluida_em = now()");
    if (body.status === "cancelada") sets.push("cancelada_em = now()");
    if (body.status === "aberta" || body.status === "em_andamento") {
      sets.push("concluida_em = NULL", "cancelada_em = NULL");
    }
  }

  if (body.depende_de !== undefined) {
    const v = typeof body.depende_de === "string" ? body.depende_de.trim() : null;
    push("depende_de", v && v !== "—" ? v.slice(0, 300) : null);
  }

  if (body.frente_id !== undefined) {
    push("frente_id", body.frente_id);
    if (body.frente_id) sets.push("frente_proposta = NULL");
  }

  if (body.area_raw !== undefined) push("area_raw", body.area_raw);
  if (body.ordem !== undefined) push("ordem", body.ordem);
  if (body.no_plano !== undefined) push("no_plano", body.no_plano);

  // Hub: time da ação (muda quem enxerga — só quem criou, e só para um time dele) e objetivo
  // (um que quem pede enxerga).
  if (body.time_id !== undefined) {
    if (acesso.papel !== "dono") return erro(403, "Só quem criou a ação muda o time dela.");
    // Pedido ao marketing: só um time das empresas do público do formulário (como no Quem vê).
    const recusaDoTime = body.time_id !== null ? await recusaDoTimeNaTarefa(user.id, id, body.time_id) : null;
    if (recusaDoTime) return erro(400, recusaDoTime);
    push("time_id", body.time_id);
  }
  if (body.objetivo_id !== undefined) {
    if (body.objetivo_id !== null && !(typeof body.objetivo_id === "string" && (await podeObjetivo(user.id, body.objetivo_id)))) {
      return erro(400, "Esse objetivo não existe ou você não o enxerga.");
    }
    // Quem não enxerga o objetivo atual não o tira nem troca (apagaria o vínculo de quem ligou sem saber).
    const atual = (
      await withTenant(donoId, (c) => c.query<{ objetivo_id: string | null }>(`SELECT objetivo_id::text FROM tarefas WHERE id = $1`, [id]))
    ).rows[0]?.objetivo_id;
    if (atual && atual !== body.objetivo_id && !(await podeObjetivo(user.id, atual))) {
      return erro(403, "A ação está num objetivo que você não vê: só quem vê esse objetivo muda.");
    }
    push("objetivo_id", body.objetivo_id);
  }

  const hasPessoas = Array.isArray(body.pessoas);
  if (!sets.length && !hasPessoas) return erro(400, "nada para atualizar");

  return {
    ok: true,
    preparo: { id, donoId, papel: acesso.papel, body, sets, values, hasPessoas, notionUserId: escolha?.notionUserId ?? null },
  };
}

/**
 * Grava a mudança já conferida. `c` precisa estar numa transação com o tenant do dono da tarefa
 * (app.current_user_id = preparo.donoId). `origem` marca o histórico (ex.: "coach"); mudança que não é
 * da tela não vira dado de correção da extração.
 */
export async function gravarMudanca(
  c: PoolClient,
  preparo: MudancaPreparada,
  opts: { ator: string | null; origem?: string },
): Promise<Record<string, unknown> | null> {
  const { id, donoId, body, sets, hasPessoas } = preparo;
  const values = [...preparo.values];
  const ator = isTeamMode() ? opts.ator : null;
  const comOrigem = <T extends object>(payload: T) => (opts.origem ? { ...payload, origem: opts.origem } : payload);
  let row: Record<string, unknown> | undefined;
  if (sets.length) {
    // pega o estado ANTES p/ registrar a correção (de→para)
    const before = (await c.query<Record<string, unknown>>("SELECT * FROM tarefas WHERE id = $1", [id])).rows[0];
    values.push(id);
    const sql = `UPDATE tarefas SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`;
    const { rows } = await c.query(sql, values);
    row = rows[0];
    if (row && body.status && before?.status !== body.status) {
      const estavaFechada = before?.status === "concluida" || before?.status === "cancelada";
      if (body.status === "concluida" || body.status === "cancelada") {
        await registrarEvento(c, id, body.status, comOrigem(body), ator);
      } else if (estavaFechada) {
        await registrarEvento(c, id, "reaberta", comOrigem(body), ator);
      } else {
        // Aberta ↔ Em andamento ↔ Aguardando aprovação: mudou a situação, não "reabriu".
        await registrarEvento(c, id, "editada", { origem: opts.origem ?? "situacao", changed: { status: { de: before?.status, para: body.status } } }, ator);
      }
    }
    // correção de conteúdo: registra de→para por campo alterado
    if (row && before) {
      const changed: Record<string, { de: unknown; para: unknown }> = {};
      for (const f of CORRECTION_FIELDS) {
        if (body[f as keyof MudancaDeTarefa] !== undefined && before[f] !== row[f]) {
          changed[f] = { de: before[f], para: row[f] };
        }
      }
      if (Object.keys(changed).length) {
        await registrarEvento(c, id, "editada", { origem: opts.origem ?? "correcao_manual", changed }, ator);
        // dataset persistente p/ o loop de feedback (sobrevive à deleção da tarefa) — só o que veio da tela
        if (!opts.origem) {
          await c.query(
            "INSERT INTO extracao_feedback (user_id, meeting_id, tipo, payload) VALUES ($1,$2,'correcao',$3)",
            [donoId, (before.meeting_id as string) ?? null, JSON.stringify({ changed })],
          );
        }
      }
      // Time e objetivo não são correção da IA: entram só no histórico da ação.
      const organizacao: Record<string, { de: unknown; para: unknown }> = {};
      for (const f of ["time_id", "objetivo_id"] as const) {
        if (body[f] !== undefined && before[f] !== row[f]) organizacao[f] = { de: before[f], para: row[f] };
      }
      if (Object.keys(organizacao).length) {
        await registrarEvento(c, id, "editada", { origem: "organizacao", changed: organizacao }, ator);
      }
    }
  } else {
    const { rows } = await c.query("SELECT * FROM tarefas WHERE id = $1", [id]);
    row = rows[0];
  }
  if (!row) return null;

  // Mudou dono/ação sem mandar `pessoas` explícitas → recalcula o flag `principal`
  // (que decide o agrupamento por pessoa). Espelha a trigger resolve_tarefa_pessoas:
  //   executar     → ninguém é principal (agrupa em "Você")
  //   cobrar/aguardar → principal = a pessoa do owner (cria/vincula se preciso)
  if (!hasPessoas && (body.owner !== undefined || body.acao !== undefined)) {
    await ajustarPrincipal(c, id, donoId, String(row.acao ?? ""), String(row.owner ?? "").trim());
  }

  if (hasPessoas) {
    await c.query("DELETE FROM tarefa_pessoas WHERE tarefa_id = $1", [id]);
    for (const p of body.pessoas!) {
      const nome = (p.nome || "").trim();
      if (!nome || nome === "?") continue;
      const pr = await c.query<{ id: string }>(
        `INSERT INTO pessoas (user_id, nome) VALUES ($1,$2)
         ON CONFLICT (user_id, nome) DO UPDATE SET updated_at = now() RETURNING id`,
        [donoId, nome],
      );
      await c.query(
        `INSERT INTO tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ($1,$2,$3)
         ON CONFLICT (tarefa_id, pessoa_id) DO UPDATE SET principal = EXCLUDED.principal`,
        [id, pr.rows[0].id, !!p.principal],
      );
    }
  }
  return row;
}

/** O que a tela faz depois de gravar: manda pro Notion (se foi pra alguém do marketing) e devolve a tarefa como quem pediu a vê. */
async function depoisDaMudanca(user: Pick<User, "id">, preparo: MudancaPreparada, row: Record<string, unknown>) {
  if (preparo.notionUserId) {
    await pedirEnvio({
      tarefaId: preparo.id,
      donoId: preparo.donoId,
      pedidoPor: user.id,
      notionUserId: preparo.notionUserId,
      bu: buDoWorkspace(preparo.body.workspace),
    });
  }
  if (preparo.papel !== "dono") {
    // Quem não criou recebe a tarefa do ponto de vista dele (sem a reunião de origem).
    const [visto] = await carregarTarefas(user.id, [{ tarefa_id: preparo.id, dono_id: preparo.donoId }]);
    return visto ? await semObjetivoEscondido(user.id, visto) : { id: preparo.id };
  }
  return semObjetivoEscondido(user.id, row as { objetivo_id?: string | null });
}

/** A mudança inteira de uma tarefa, como a tela faz. */
export async function mudarTarefa(
  user: Pick<User, "id">,
  id: string,
  entrada: MudancaDeTarefa,
): Promise<{ status: number; json: unknown }> {
  const p = await prepararMudanca(user, id, entrada);
  if (!p.ok) return { status: p.status, json: { error: p.erro } };
  try {
    const row = await withTenant(p.preparo.donoId, (c) => gravarMudanca(c, p.preparo, { ator: user.id }));
    if (!row) return { status: 404, json: { error: "tarefa não encontrada" } };
    return { status: 200, json: await depoisDaMudanca(user, p.preparo, row) };
  } catch (e: unknown) {
    return { status: 500, json: { error: e instanceof Error ? e.message : String(e) } };
  }
}
