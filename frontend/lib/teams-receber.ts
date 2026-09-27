// O lado do banco da reunião que vem do Teams (regras puras em teams.ts).
//
// O TTARS pergunta a cada 5 min quais reuniões recém-acabadas interessam (`quais`) e manda a
// transcrição só dessas (`receber`). A reunião nasce na conta de quem marcou, aberta só para
// quem da Welcome estava nela (meeting_acessos), e passa pelo mesmo resumo e extração de ações
// da reunião gravada pela aba (fluxo acoes-reprocess-tarefas do n8n da equipe).

import { timingSafeEqual } from "node:crypto";
import { query, withTenant } from "./db";
import { garantirColegaDoTtars } from "./equipe-compartilhado";
import {
  type Candidato,
  type ContextoDaDecisao,
  type Legenda,
  chamadosDaReuniao,
  decidir,
  LETRAS_MINIMAS,
  montarConversa,
  normalizarEmail,
  pessoasDaReuniao,
} from "./teams";

/** O TTARS se apresenta com a chave combinada (guardada cifrada lá, em integration_settings). */
export function chaveDoTtarsConfere(req: Request): boolean {
  const esperada = process.env.ACOES_TEAMS_TOKEN || "";
  const veio = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (esperada.length < 32) return false;
  const a = Buffer.from(veio);
  const b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Conversa curta demais já recusada: o TTARS continua perguntando por ~3 h; aqui a resposta
// passa a ser "não quero" sem refazer a conta (some se o servidor reiniciar, sem problema).
const recusadas = new Map<string, string>();

async function contexto(candidatos: Candidato[]): Promise<ContextoDaDecisao> {
  const [lib, pessoas] = await Promise.all([
    query<{ email: string }>(
      `SELECT LOWER(email) AS email FROM acessos_equipe WHERE liberado
       UNION SELECT LOWER(email) FROM users WHERE is_admin AND deleted_at IS NULL AND email IS NOT NULL`,
    ),
    query<{ email: string }>(`SELECT email FROM ttars_pessoas WHERE organizacao <> ''`),
  ]);
  const ctx: ContextoDaDecisao = {
    liberados: new Set(lib.map((r) => r.email)),
    welcome: new Set(pessoas.map((r) => normalizarEmail(r.email))),
    jaTem: new Set<string>(),
    gravadasAqui: new Map<string, number[]>(),
  };
  if (!candidatos.length) return ctx;
  // Quem marcou (reunião do Teams já trazida) e quem da Welcome estava (gravou pelo Ações?).
  const emails = [...new Set(candidatos.flatMap((c) => pessoasDaReuniao(c, ctx.welcome)))];
  if (!emails.length) return ctx;
  const users = await query<{ id: string; email: string }>(
    `SELECT id::text AS id, LOWER(email) AS email FROM users WHERE LOWER(email) = ANY($1) AND deleted_at IS NULL`,
    [emails],
  );
  const anotar = (email: string, t: number) => ctx.gravadasAqui.set(email, [...(ctx.gravadasAqui.get(email) ?? []), t]);
  for (const u of users) {
    const dela = candidatos.filter((c) => pessoasDaReuniao(c, ctx.welcome).includes(u.email));
    const de = new Date(Math.min(...dela.map((c) => Date.parse(c.inicio))) - 3600_000).toISOString();
    const ate = new Date(Math.max(...dela.map((c) => Date.parse(c.fim)))).toISOString();
    const chaves = dela.filter((c) => normalizarEmail(c.organizador) === u.email).map((c) => c.chave);
    const r = await withTenant(u.id, (c) =>
      c.query<{ teams_evento: string | null; t: string | null }>(
        `SELECT teams_evento,
                CASE WHEN source <> 'teams' THEN (extract(epoch FROM recorded_at) * 1000)::bigint::text END AS t
           FROM meetings
          WHERE user_id = $1
            AND (teams_evento = ANY($2) OR (source <> 'teams' AND recorded_at BETWEEN $3 AND $4))`,
        [u.id, chaves, de, ate],
      ),
    );
    for (const row of r.rows) {
      if (row.teams_evento) ctx.jaTem.add(`${u.email}|${row.teams_evento}`);
      if (row.t) anotar(u.email, Number(row.t));
    }
    // Gravação pelo Ações ainda em andamento ou virando reunião (a reunião só nasce depois).
    const sessoes = await query<{ t: string }>(
      `SELECT (extract(epoch FROM created_at) * 1000)::bigint::text AS t FROM gravacao_sessoes
        WHERE user_id = $1 AND created_at BETWEEN $2 AND $3 AND COALESCE(chunks_count, 0) > 0`,
      [u.id, de, ate],
    );
    for (const row of sessoes) anotar(u.email, Number(row.t));
  }
  return ctx;
}

const chaveCompleta = (c: Candidato) => `${normalizarEmail(c.organizador)}|${c.chave}`;

export async function quais(candidatos: Candidato[]) {
  const ctx = await contexto(candidatos);
  const respostas = candidatos.map((c) => {
    const recusada = recusadas.get(chaveCompleta(c));
    const d = recusada ? { quero: false, motivo: recusada } : decidir(c, ctx);
    return { chave: c.chave, organizador: normalizarEmail(c.organizador), ...d };
  });
  await retomarParadas();
  return respostas;
}

export type PedidoDaReuniao = Candidato & { legendas: Legenda[] };

export async function receber(p: PedidoDaReuniao): Promise<{ meeting_id?: string; ignorada?: string }> {
  const org = normalizarEmail(p.organizador);
  const recusada = recusadas.get(chaveCompleta(p));
  if (recusada) return { ignorada: recusada };
  const ctx = await contexto([p]);
  const d = decidir(p, ctx);
  if (!d.quero) return { ignorada: d.motivo };

  const conversa = montarConversa(p.legendas);
  if (conversa.letras < LETRAS_MINIMAS) {
    recusadas.set(chaveCompleta(p), "conversa curta demais");
    return { ignorada: "conversa curta demais" };
  }

  const dono = await garantirColegaDoTtars(org);
  if (!dono) return { ignorada: "quem marcou não é da Welcome" };
  // Quem gravou a mesma reunião pelo Ações já tem a dele: não recebe esta também.
  const convidados = chamadosDaReuniao(p, ctx);
  const chamados: string[] = [];
  for (const email of convidados) {
    const colega = await garantirColegaDoTtars(email);
    if (colega && colega.id !== dono.id) chamados.push(colega.id);
  }

  const comeco = [...p.legendas].map((l) => l.criado).sort()[0] ?? p.inicio;
  const assunto = (p.assunto || "").trim().slice(0, 200) || null;
  const id = await withTenant(dono.id, async (c) => {
    // Duas rodadas do TTARS com a mesma reunião ao mesmo tempo: só uma cria.
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`teams:${chaveCompleta(p)}`]);
    const ja = await c.query(`SELECT 1 FROM meetings WHERE user_id = $1 AND teams_evento = $2`, [dono.id, p.chave]);
    if (ja.rows.length) return null;
    const r = await c.query<{ id: string }>(
      `INSERT INTO meetings (user_id, source, meeting_type, original_filename, nome, recorded_at, duration_seconds,
                             status, transcription, segments, speaker_labels, visibilidade, teams_evento, teams_convidados)
       VALUES ($1, 'teams', 'online', $2, $3, $4, $5, 'analyzing', $6, $7::jsonb, $8::jsonb, $9, $10, $11)
       RETURNING id::text AS id`,
      [
        dono.id,
        `Teams · ${assunto ?? "reunião"}`,
        assunto,
        comeco,
        conversa.duracao || Math.round((Date.parse(p.fim) - Date.parse(p.inicio)) / 1000),
        conversa.texto,
        JSON.stringify(conversa.segments),
        JSON.stringify(conversa.labels),
        chamados.length ? "escolhidos" : "so_eu",
        p.chave,
        convidados,
      ],
    );
    const meetingId = r.rows[0].id;
    for (const uid of chamados) {
      await c.query(
        `INSERT INTO meeting_acessos (meeting_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [meetingId, uid],
      );
    }
    return meetingId;
  });
  if (!id) return { ignorada: "já está no Ações" };
  analisarDepois(id, dono.id);
  return { meeting_id: id };
}

// ── resumo e ações: o mesmo fluxo da reunião gravada ──────────────────────────────────────
const analisando = new Set<string>();
const FALHOU = 'O resumo e as ações não saíram. Use "Refazer".';

function analisarDepois(meetingId: string, userId: string) {
  if (analisando.has(meetingId)) return;
  analisando.add(meetingId);
  void (async () => {
    const url = process.env.N8N_REPROCESS_URL;
    try {
      if (!url) throw new Error("N8N_REPROCESS_URL não configurada");
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meeting_id: meetingId, user_id: userId }),
        signal: AbortSignal.timeout(15 * 60_000),
      });
      // Resposta de erro com o resumo gravado = o fluxo terminou (quem cortou foi o caminho).
      await withTenant(userId, (c) =>
        c.query(
          `UPDATE meetings
              SET status = CASE WHEN $2 OR summary IS NOT NULL THEN 'done' ELSE 'error' END,
                  done_at = CASE WHEN $2 OR summary IS NOT NULL THEN now() END,
                  status_error = CASE WHEN $2 OR summary IS NOT NULL THEN NULL ELSE $3 END
            WHERE id = $1 AND status = 'analyzing'`,
          [meetingId, r.ok, FALHOU],
        ),
      );
    } catch (e) {
      // Sem resposta: fica "analisando" e a próxima pergunta do TTARS confere (retomarParadas).
      console.error("[teams] análise", meetingId, e instanceof Error ? e.message : e);
    } finally {
      analisando.delete(meetingId);
    }
  })();
}

/**
 * Reunião do Teams parada em "analisando" há mais de 20 min (o servidor reiniciou no meio, ou a
 * resposta se perdeu): se o resumo já foi gravado, fica pronta; senão tenta UMA vez de novo;
 * parada de novo depois disso vira erro com "Refazer" (nunca paga a IA uma terceira vez sozinha).
 */
async function retomarParadas() {
  try {
    const r = await query<{ meeting_id: string; user_id: string; tem_resumo: boolean; ja_retomada: boolean }>(
      `SELECT meeting_id::text, user_id::text, tem_resumo, ja_retomada FROM equipe_teams_paradas()`,
    );
    for (const p of r) {
      if (analisando.has(p.meeting_id)) continue;
      if (p.tem_resumo || p.ja_retomada) {
        await withTenant(p.user_id, (c) =>
          c.query(
            `UPDATE meetings SET status = $2, done_at = CASE WHEN $2 = 'done' THEN now() END, status_error = $3
              WHERE id = $1 AND status = 'analyzing'`,
            [p.meeting_id, p.tem_resumo ? "done" : "error", p.tem_resumo ? null : FALHOU],
          ),
        );
        continue;
      }
      await withTenant(p.user_id, (c) =>
        c.query(`UPDATE meetings SET status_error = 'retomada' WHERE id = $1 AND status = 'analyzing'`, [p.meeting_id]),
      );
      analisarDepois(p.meeting_id, p.user_id);
    }
  } catch (e) {
    console.error("[teams] retomar", e instanceof Error ? e.message : e);
  }
}
