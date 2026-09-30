// O lado do banco da reunião que vem do Teams (regras puras em teams.ts).
//
// O TTARS pergunta a cada 5 min quais reuniões recém-acabadas interessam (`quais`) e manda a
// transcrição só dessas (`receber`). A reunião nasce na conta de quem marcou, aberta só para
// quem da Welcome estava nela (meeting_acessos), e passa pelo mesmo resumo e extração de ações
// da reunião gravada pela aba (fluxo acoes-reprocess-tarefas do n8n da equipe).

import { timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { query, withTenant } from "./db";
import { garantirColegaDoTtars } from "./equipe-compartilhado";
import { MARCA_DO_TEAMS } from "./ttars-auth";
import {
  type Candidato,
  type ContextoDaDecisao,
  type Legenda,
  CHEGANDO,
  CHEGANDO_EXPIRA_MS,
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
    // Quem só está no Teams (sem TTARS) não conta como "da Welcome" para reunião: a reunião
    // nasceria numa conta que ninguém abre (revisão de 29/09/2026).
    query<{ email: string }>(`SELECT email FROM ttars_pessoas WHERE organizacao <> '' AND LEFT(organizacao, $1) <> $2`, [
      MARCA_DO_TEAMS.length,
      MARCA_DO_TEAMS,
    ]),
  ]);
  const ctx: ContextoDaDecisao = {
    liberados: new Set(lib.map((r) => r.email)),
    welcome: new Set(pessoas.map((r) => normalizarEmail(r.email))),
    jaTem: new Set<string>(),
    chegando: new Set<string>(),
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
      c.query<{ teams_evento: string | null; t: string | null; chegando: boolean }>(
        `SELECT teams_evento,
                CASE WHEN source <> 'teams' THEN (extract(epoch FROM recorded_at) * 1000)::bigint::text END AS t,
                (source = 'teams' AND status = $5) AS chegando
           FROM meetings
          WHERE user_id = $1
            AND (teams_evento = ANY($2) OR (source <> 'teams' AND recorded_at BETWEEN $3 AND $4))
         UNION ALL
         SELECT teams_evento, NULL, false FROM teams_apagadas WHERE user_id = $1 AND teams_evento = ANY($2)`,
        [u.id, chaves, de, ate, CHEGANDO],
      ),
    );
    for (const row of r.rows) {
      // A que está chegando continua querida: é nela que a transcrição entra.
      if (row.teams_evento) (row.chegando ? ctx.chegando : ctx.jaTem).add(`${u.email}|${row.teams_evento}`);
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
  // A que estava chegando e deixou de ser querida (quem marcou gravou pelo Ações, por exemplo) sai.
  for (const [i, c] of candidatos.entries()) {
    if (!respostas[i].quero && ctx.chegando.has(chaveCompleta(c))) await largarChegando(c);
  }
  await retomarParadas();
  await limparChegandoVelhas();
  return respostas;
}

export type PedidoDaReuniao = Candidato & { legendas: Legenda[] };

/** A reunião nasce na conta de quem marcou; quem da Welcome estava no convite vê e puxa. */
async function donoEChamados(p: Candidato, ctx: ContextoDaDecisao) {
  const dono = await garantirColegaDoTtars(normalizarEmail(p.organizador));
  if (!dono) return null;
  // Quem gravou a mesma reunião pelo Ações já tem a dele: não recebe esta também.
  const convidados = chamadosDaReuniao(p, ctx);
  const chamados: Array<{ email: string; id: string }> = [];
  for (const email of convidados) {
    const colega = await garantirColegaDoTtars(email);
    if (colega && colega.id !== dono.id) chamados.push({ email, id: colega.id });
  }
  return { dono, convidados, chamados };
}

async function abrirParaChamados(c: PoolClient, meetingId: string, chamados: Array<{ id: string }>) {
  for (const { id: uid } of chamados) {
    await c.query(
      `INSERT INTO meeting_acessos (meeting_id, user_id, motivo) VALUES ($1, $2, 'convidado') ON CONFLICT DO NOTHING`,
      [meetingId, uid],
    );
  }
}

const assuntoDe = (p: Candidato) => (p.assunto || "").trim().slice(0, 200) || null;

// Duas rodadas do TTARS com a mesma reunião ao mesmo tempo: só uma cria.
const travar = (c: PoolClient, p: Candidato) => c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`teams:${chaveCompleta(p)}`]);

export async function receber(p: PedidoDaReuniao): Promise<{ meeting_id?: string; ignorada?: string }> {
  const recusada = recusadas.get(chaveCompleta(p));
  if (recusada) return { ignorada: recusada };
  const ctx = await contexto([p]);
  const d = decidir(p, ctx);
  if (!d.quero) return { ignorada: d.motivo };

  const conversa = montarConversa(p.legendas);
  if (conversa.letras < LETRAS_MINIMAS) {
    recusadas.set(chaveCompleta(p), "conversa curta demais");
    await largarChegando(p);
    return { ignorada: "conversa curta demais" };
  }

  const gente = await donoEChamados(p, ctx);
  if (!gente) return { ignorada: "quem marcou não é da Welcome" };
  const { dono, convidados, chamados } = gente;

  const comeco = [...p.legendas].map((l) => l.criado).sort()[0] ?? p.inicio;
  const assunto = assuntoDe(p);
  const id = await withTenant(dono.id, async (c) => {
    await travar(c, p);
    const ja = await c.query<{ id: string | null; chegando: boolean; chamados_antes: string[] | null }>(
      `SELECT id::text AS id, status = $3 AS chegando, teams_convidados AS chamados_antes
         FROM meetings WHERE user_id = $1 AND teams_evento = $2
       UNION ALL SELECT NULL, false, NULL FROM teams_apagadas WHERE user_id = $1 AND teams_evento = $2`,
      [dono.id, p.chave, CHEGANDO],
    );
    const chegou = ja.rows.length === 1 && ja.rows[0].chegando ? ja.rows[0].id : null;
    if (ja.rows.length && !chegou) return null;
    const valores = [
      dono.id,
      `Teams · ${assunto ?? "reunião"}`,
      assunto,
      comeco,
      conversa.duracao || Math.round((Date.parse(p.fim) - Date.parse(p.inicio)) / 1000),
      conversa.texto,
      JSON.stringify(conversa.segments),
      JSON.stringify(conversa.labels),
      p.chave,
      convidados,
    ];
    if (chegou) {
      // A que estava chegando vira a reunião: o nome e quem vê que quem marcou já mexeu ficam.
      // created_at = agora: a retomada de 50 min conta desde a leitura, não desde o "chegando".
      const r = await c.query(
        `UPDATE meetings
            SET original_filename = $2, nome = COALESCE(nome, $3), recorded_at = $4, duration_seconds = $5,
                status = 'analyzing', status_error = NULL, transcription = $6, segments = $7::jsonb,
                speaker_labels = $8::jsonb, teams_convidados = $10, created_at = now()
          WHERE id = $11 AND user_id = $1 AND teams_evento = $9 AND status = $12`,
        [...valores, chegou, CHEGANDO],
      );
      if (!r.rowCount) return null;
      // Só quem entrou no convite depois: quem marcou pode ter tirado alguém enquanto ela chegava
      // (revisão de 30/09), e quem já estava continua como está.
      const antes = new Set((ja.rows[0].chamados_antes ?? []).map(normalizarEmail));
      await abrirParaChamados(c, chegou, chamados.filter((x) => !antes.has(normalizarEmail(x.email))));
      return chegou;
    }
    // Quem estava no convite vê (e puxa); ninguém mais sem quem marcou escolher (pedido do Vitor, 28/09).
    const r = await c.query<{ id: string }>(
      `INSERT INTO meetings (user_id, source, meeting_type, original_filename, nome, recorded_at, duration_seconds,
                             status, transcription, segments, speaker_labels, visibilidade, teams_evento, teams_convidados)
       VALUES ($1, 'teams', 'online', $2, $3, $4, $5, 'analyzing', $6, $7::jsonb, $8::jsonb, 'escolhidos', $9, $10)
       RETURNING id::text AS id`,
      valores,
    );
    await abrirParaChamados(c, r.rows[0].id, chamados);
    return r.rows[0].id;
  });
  if (!id) return { ignorada: "já está no Ações" };
  analisarDepois(id, dono.id);
  return { meeting_id: id };
}

/** O Teams já tem a transcrição, mas ela ainda fecha: a reunião nasce aqui como "chegando", sem
 *  conversa, para quem estava nela ver na hora. O TTARS chama a cada rodada até mandar a
 *  transcrição (`receber`, que completa esta mesma reunião); chamar de novo não cria outra. */
export async function chegando(p: Candidato): Promise<{ meeting_id?: string; ignorada?: string }> {
  const recusada = recusadas.get(chaveCompleta(p));
  if (recusada) return { ignorada: recusada };
  const ctx = await contexto([p]);
  const d = decidir(p, ctx);
  if (!d.quero) return { ignorada: d.motivo };
  const gente = await donoEChamados(p, ctx);
  if (!gente) return { ignorada: "quem marcou não é da Welcome" };
  const { dono, convidados, chamados } = gente;
  const assunto = assuntoDe(p);
  const id = await withTenant(dono.id, async (c) => {
    await travar(c, p);
    const ja = await c.query<{ id: string | null }>(
      `SELECT id::text AS id FROM meetings WHERE user_id = $1 AND teams_evento = $2
       UNION ALL SELECT NULL FROM teams_apagadas WHERE user_id = $1 AND teams_evento = $2`,
      [dono.id, p.chave],
    );
    if (ja.rows.length) return ja.rows[0].id;
    const r = await c.query<{ id: string }>(
      `INSERT INTO meetings (user_id, source, meeting_type, original_filename, nome, recorded_at, status, visibilidade,
                             teams_evento, teams_convidados)
       VALUES ($1, 'teams', 'online', $2, $3, $4, $5, 'escolhidos', $6, $7)
       RETURNING id::text AS id`,
      [dono.id, `Teams · ${assunto ?? "reunião"}`, assunto, p.inicio, CHEGANDO, p.chave, convidados],
    );
    await abrirParaChamados(c, r.rows[0].id, chamados);
    return r.rows[0].id;
  });
  return id ? { meeting_id: id } : { ignorada: "já está no Ações" };
}

/** Tira a reunião que estava chegando. A ação que quem marcou já criou nela fica, solta da reunião
 *  (a reunião apagada levaria junto; revisão de 30/09). FOR UPDATE: se a transcrição a completou no
 *  meio do caminho, ela deixa de ser "chegando" e fica (2ª revisão de 30/09). */
async function apagarChegando(c: PoolClient, userId: string, onde: string, valores: unknown[]) {
  const alvo = await c.query<{ id: string }>(
    `SELECT id::text AS id FROM meetings WHERE user_id = $1 AND source = 'teams' AND status = $2 AND ${onde} FOR UPDATE`,
    [userId, CHEGANDO, ...valores],
  );
  const ids = alvo.rows.map((x) => x.id);
  if (!ids.length) return;
  await c.query(`UPDATE tarefas SET meeting_id = NULL WHERE meeting_id = ANY($1::uuid[])`, [ids]);
  await c.query(`DELETE FROM meetings WHERE id = ANY($1::uuid[]) AND status = $2`, [ids, CHEGANDO]);
}

/** A que estava chegando e não vai virar reunião (conversa curta, deixou de ser querida) sai. */
async function largarChegando(p: Candidato) {
  const [dono] = await query<{ id: string }>(
    `SELECT id::text AS id FROM users WHERE LOWER(email) = $1 AND deleted_at IS NULL`,
    [normalizarEmail(p.organizador)],
  );
  if (!dono) return;
  await withTenant(dono.id, async (c) => {
    await travar(c, p);
    await apagarChegando(c, dono.id, "teams_evento = $3", [p.chave]);
  });
}

let ultimaLimpeza = 0;

/** "Chegando" que a transcrição nunca alcançou (o TTARS só pergunta até 3 h depois do fim) sai.
 *  A cada 30 min, conta por conta (cada conta só mexe nas suas reuniões). */
async function limparChegandoVelhas() {
  if (Date.now() - ultimaLimpeza < 30 * 60_000) return;
  ultimaLimpeza = Date.now();
  try {
    const contas = await query<{ id: string }>(`SELECT id::text AS id FROM users WHERE deleted_at IS NULL`);
    for (const u of contas) {
      await withTenant(u.id, (c) => apagarChegando(c, u.id, "created_at < now() - make_interval(secs => $3)", [CHEGANDO_EXPIRA_MS / 1000]));
    }
  } catch (e) {
    console.error("[teams] limpar chegando", e instanceof Error ? e.message : e);
  }
}

// ── resumo e ações: o mesmo fluxo da reunião gravada ──────────────────────────────────────
const analisando = new Set<string>();
const FALHOU = 'O resumo e as ações não saíram. Toque em "Tentar de novo".';

/** Roda o resumo e as ações em segundo plano; quem fecha a situação (pronta/erro) é esta função
 *  ou a retomada. Também é o "Tentar de novo" da reunião do Teams que deu erro. */
export function analisarDepois(meetingId: string, userId: string) {
  if (analisando.has(meetingId)) return;
  analisando.add(meetingId);
  void (async () => {
    const url = process.env.N8N_REPROCESS_URL;
    try {
      if (!url) throw new Error("N8N_REPROCESS_URL não configurada");
      // O servidor roda no Bun, cujo fetch desiste sozinho em 5 min, antes do limite de 25 min: a
      // leitura do Teams (mais longa desde a Luna) ficava "analisando" até a retomada de 50 min
      // (30/09/2026). `timeout: false` desliga só o limite do Bun.
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meeting_id: meetingId, user_id: userId }),
        signal: AbortSignal.timeout(25 * 60_000),
        timeout: false,
      } as RequestInit);
      // Resposta de erro, mas as ações já foram gravadas = o fluxo terminou (quem cortou foi o
      // caminho). O resumo sozinho não prova: o fluxo grava o resumo antes das ações.
      await withTenant(userId, (c) =>
        c.query(
          `WITH fim AS (SELECT $2::boolean OR EXISTS (SELECT 1 FROM tarefas WHERE meeting_id = $1) AS ok)
           UPDATE meetings
              SET status = CASE WHEN fim.ok THEN 'done' ELSE 'error' END,
                  done_at = CASE WHEN fim.ok THEN now() END,
                  status_error = CASE WHEN fim.ok THEN NULL ELSE $3 END
             FROM fim
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
 * Reunião do Teams parada em "analisando" há mais de 50 min (o servidor reiniciou no meio, ou a
 * resposta se perdeu): com as ações gravadas, fica pronta; sem, tenta UMA vez de novo; parada de
 * novo depois disso vira erro com "Tentar de novo" (nunca paga a IA uma terceira vez sozinha).
 */
async function retomarParadas() {
  try {
    const r = await query<{ meeting_id: string; user_id: string; tem_tarefas: boolean; ja_retomada: boolean }>(
      `SELECT meeting_id::text, user_id::text, tem_tarefas, ja_retomada FROM equipe_teams_paradas()`,
    );
    for (const p of r) {
      if (analisando.has(p.meeting_id)) continue;
      if (p.tem_tarefas || p.ja_retomada) {
        await withTenant(p.user_id, (c) =>
          c.query(
            `UPDATE meetings SET status = $2, done_at = CASE WHEN $2 = 'done' THEN now() END, status_error = $3
              WHERE id = $1 AND status = 'analyzing'`,
            [p.meeting_id, p.tem_tarefas ? "done" : "error", p.tem_tarefas ? null : FALHOU],
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
