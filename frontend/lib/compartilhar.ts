// Tarefa compartilhada na equipe: regras puras (sem banco), testadas em compartilhar.test.ts.
//
// A tarefa é sempre de quem a criou (tarefas.user_id). Ela chega a outra pessoa de dois
// jeitos: passada a um colega (responsavel_user_id) ou num projeto com pessoas. Quem a vê
// sem ser o criador recebe a tarefa "do seu ponto de vista": o slug do dono ("eu") passa a
// querer dizer ELE, e o que era do criador aparece com o nome do criador.

import type { Acao, Tarefa } from "./queries";

export type Colega = { id: string; nome: string };

export function slugNome(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Colega pelo nome digitado: nome inteiro igual ou, se só um tiver, o primeiro nome. */
export function acharColegaPorNome(colegas: Colega[], nome: string | null | undefined): Colega | null {
  const alvo = slugNome(nome);
  if (!alvo) return null;
  const inteiro = colegas.find((c) => slugNome(c.nome) === alvo);
  if (inteiro) return inteiro;
  if (alvo.includes("-")) return null;
  const peloPrimeiro = colegas.filter((c) => slugNome(c.nome).split("-")[0] === alvo);
  return peloPrimeiro.length === 1 ? peloPrimeiro[0] : null;
}

export type PedidoDono = {
  owner?: string;
  acao?: Acao;
  responsavel_user_id?: string | null;
  pessoas?: { nome: string; principal?: boolean }[];
};

export type DonoResolvido = {
  owner?: string;
  acao?: Acao;
  /** undefined = não mexe; null = tira de quem estava; id = passa para esse colega. */
  responsavel?: string | null;
  pessoas?: { nome: string; principal?: boolean }[];
  erro?: string;
};

/**
 * Traduz o pedido de troca de dono para o que se grava na tarefa (do ponto de vista de
 * quem a criou). `slug` é o dono da conta ("eu" na equipe).
 *   - colega escolhido pela lista (responsavel_user_id) ou digitado com o nome dele → a
 *     tarefa vai para a lista dele (owner = nome dele, cobrar);
 *   - o próprio criador → volta a ser dele (owner = slug, executar);
 *   - o slug sem colega → é do criador (quem não criou e escolhe "sem dono" devolve a ele);
 *   - nome de fora da equipe → só o nome, como sempre foi.
 */
export function resolverDono(
  pedido: PedidoDono,
  ctx: { donoId: string; colegas: Colega[]; slug: string },
): DonoResolvido {
  const querDono = pedido.owner !== undefined || pedido.responsavel_user_id !== undefined;
  const out: DonoResolvido = {};
  const doCriador = (): DonoResolvido => ({ owner: ctx.slug, acao: "executar", responsavel: null });
  const paraColega = (c: Colega): DonoResolvido => ({ owner: c.nome, acao: "cobrar", responsavel: c.id });

  if (pedido.responsavel_user_id !== undefined && pedido.responsavel_user_id !== null) {
    const c = ctx.colegas.find((x) => x.id === pedido.responsavel_user_id);
    if (!c) return { erro: "Essa pessoa não está no Ações da equipe." };
    Object.assign(out, c.id === ctx.donoId ? doCriador() : paraColega(c));
  } else if (pedido.owner !== undefined) {
    const nome = pedido.owner.trim();
    if (!nome || nome === "?" || slugNome(nome) === slugNome(ctx.slug)) {
      Object.assign(out, doCriador());
    } else {
      const c = acharColegaPorNome(ctx.colegas, nome);
      if (c) Object.assign(out, c.id === ctx.donoId ? doCriador() : paraColega(c));
      else
        Object.assign(out, {
          owner: nome,
          acao: pedido.acao === "aguardar" ? "aguardar" : "cobrar",
          responsavel: null,
        });
    }
  } else if (pedido.responsavel_user_id === null) {
    out.responsavel = null;
  } else if (pedido.acao !== undefined) {
    // Só a ação, sem dono: "executar" é do criador; o resto não muda quem é o dono.
    if (pedido.acao === "executar") Object.assign(out, doCriador());
    else out.acao = pedido.acao;
  }

  if (pedido.pessoas) {
    // O criador não entra como "pessoa" da própria tarefa: quem é dele é o slug.
    const criador = ctx.colegas.find((c) => c.id === ctx.donoId);
    let pessoas = pedido.pessoas.filter(
      (p) => !criador || slugNome(p.nome) !== slugNome(criador.nome),
    );
    if (querDono && out.responsavel) {
      const nomeDono = out.owner!;
      pessoas = [
        { nome: nomeDono, principal: true },
        ...pessoas.filter((p) => slugNome(p.nome) !== slugNome(nomeDono)).map((p) => ({ nome: p.nome })),
      ];
    } else if (querDono && out.owner === ctx.slug) {
      pessoas = pessoas.map((p) => ({ nome: p.nome }));
    }
    out.pessoas = pessoas;
  }
  return out;
}

/** Campos da tarefa que falam da reunião de onde ela saiu — ficam só com quem gravou. */
const SEM_REUNIAO: Partial<Tarefa> = {
  meeting_id: null,
  evidencia: null,
  meeting_summary: null,
  meeting_nome: null,
  meeting_duracao: null,
  meeting_recorded_at: null,
  meeting_type: null,
  parece_com_id: null,
  parece_com: null,
  mencoes: [],
  no_plano: false,
};

/**
 * A tarefa como quem está vendo deve enxergar.
 * `donoNome` liga o nome de quem é a tarefa (usado pelo projeto para mostrar e agrupar
 * por pessoa, já que "eu" não diz nada para os outros).
 */
export function paraQuemVe(
  t: Tarefa,
  ctx: { viewerId: string; slug: string; nomes: Map<string, string>; donoNome?: boolean },
): Tarefa {
  const criador = ctx.nomes.get(t.user_id) ?? "Colega";
  const principal = t.pessoas?.find((p) => p.principal)?.nome ?? null;
  const ehDoCriador = slugNome(t.owner) === slugNome(ctx.slug);
  const donoNome = ctx.donoNome ? (principal ?? (ehDoCriador ? criador : t.owner)) : undefined;

  if (t.user_id === ctx.viewerId) {
    return donoNome === undefined ? t : { ...t, dono_nome: donoNome };
  }

  let owner = t.owner;
  let acao: Acao = t.acao;
  let isMine = false;
  let pessoas = t.pessoas;
  if (t.responsavel_user_id === ctx.viewerId) {
    owner = ctx.slug;
    acao = "executar";
    isMine = true;
    // O nome dele é a pessoa principal na conta de quem criou; pra ele, isso já é o "Você".
    const eu = slugNome(ctx.nomes.get(ctx.viewerId));
    pessoas = (t.pessoas ?? []).filter((p) => !eu || slugNome(p.nome) !== eu);
  } else if (ehDoCriador) {
    owner = criador;
    acao = "cobrar";
  }

  return {
    ...t,
    ...SEM_REUNIAO,
    owner,
    acao,
    is_mine: isMine,
    pessoas,
    compartilhada: true,
    criador_nome: criador,
    ...(donoNome !== undefined ? { dono_nome: donoNome } : {}),
  };
}

/** Abertas primeiro; entre abertas, com prazo antes e o mais cedo primeiro. */
export function ordenarPendencias(a: Tarefa, b: Tarefa): number {
  const fechada = (t: Tarefa) => (t.status === "concluida" || t.status === "cancelada" ? 1 : 0);
  if (fechada(a) !== fechada(b)) return fechada(a) - fechada(b);
  const ag = (t: Tarefa) => (t.acao === "aguardar" ? 1 : 0);
  if (ag(a) !== ag(b)) return ag(a) - ag(b);
  if (!a.prazo !== !b.prazo) return a.prazo ? -1 : 1;
  if (a.prazo && b.prazo && a.prazo !== b.prazo) return a.prazo < b.prazo ? -1 : 1;
  return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
}
