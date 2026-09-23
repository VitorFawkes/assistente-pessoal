// Ensaio da comparação de tarefas repetidas nas reuniões que já aconteceram.
//
// Reprocessa as reuniões na ordem em que aconteceram, como se a comparação já
// estivesse ligada desde o começo: a cada reunião, as tarefas dela são
// comparadas com as que estariam na lista naquele dia (abertas + concluídas há
// até 30 dias). O que o juiz juntar sai da lista simulada; o resto entra.
// Não escreve em banco nenhum: lê um JSON exportado e grava o resultado em
// arquivos, retomando de onde parou se for interrompido.
//
// Uso:
//   OPENAI_API_KEY=... bun scripts/tarefas-repetidas-replay.ts \
//     --dados tarefas.json --saida pasta/ [--limite 10] [--reunioes id1,id2]
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  compararComExistentes,
  vetorizar,
  textoParaVetor,
  hashTexto,
  DIAS_CONCLUIDA,
  type Candidata,
} from "../lib/tarefas-repetidas";

type Linha = {
  id: string;
  meeting_id: string | null;
  parent_meeting_id: string | null;
  meeting_status: string | null;
  reuniao_em: string | null;
  titulo: string;
  descricao: string | null;
  owner: string | null;
  status: string;
  evidencia: string | null;
  created_at: string;
  concluida_em: string | null;
  reuniao_rotulo: string | null;
};

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const dados = arg("dados");
const saida = arg("saida");
if (!dados || !saida) throw new Error("use --dados <json> --saida <pasta>");
const limite = Number(arg("limite") ?? Infinity);
const soReunioes = new Set((arg("reunioes") ?? "").split(",").filter(Boolean));
mkdirSync(saida, { recursive: true });

const linhas = JSON.parse(readFileSync(dados, "utf8")) as Linha[];
// Tarefas da gravação inteira que depois foi fatiada ficam de fora: isso é
// outra correção (as partes substituem a gravação inteira).
const validas = linhas.filter((l) => l.meeting_status !== "archived_session");
const manuais = validas.filter((l) => !l.meeting_id).sort((a, b) => a.created_at.localeCompare(b.created_at));
const porReuniao = new Map<string, Linha[]>();
for (const l of validas) {
  if (!l.meeting_id) continue;
  if (!porReuniao.has(l.meeting_id)) porReuniao.set(l.meeting_id, []);
  porReuniao.get(l.meeting_id)!.push(l);
}
const reunioes = [...porReuniao.entries()]
  .map(([id, ts]) => ({ id, em: ts[0].reuniao_em ?? ts[0].created_at, tarefas: ts }))
  .sort((a, b) => a.em.localeCompare(b.em));

// ─── vetores (cache em arquivo) ──────────────────────────────────────
const cacheVetores = join(saida, "vetores.json");
const vetores: Record<string, number[]> = existsSync(cacheVetores)
  ? JSON.parse(readFileSync(cacheVetores, "utf8"))
  : {};
const faltam = validas.filter((l) => !vetores[hashTexto(textoParaVetor(l))]);
if (faltam.length) {
  const vs = await vetorizar(faltam.map((l) => textoParaVetor(l)));
  faltam.forEach((l, i) => (vetores[hashTexto(textoParaVetor(l))] = vs[i]));
  writeFileSync(cacheVetores, JSON.stringify(vetores));
  console.log(`vetores novos: ${faltam.length}`);
}
const vetorDe = (l: Linha) => vetores[hashTexto(textoParaVetor(l))];

// ─── retomada ────────────────────────────────────────────────────────
const arqDecisoes = join(saida, "decisoes.jsonl");
type Registro = {
  reuniao: string;
  reuniao_em: string;
  tarefa: string;
  titulo: string;
  tipo: "nova" | "mesma" | "duvida";
  votos: number;
  alvo: string | null;
  alvo_titulo: string | null;
  alvo_status: string | null;
  alvo_em: string | null;
  similaridade: number | null;
  mais_parecida: number | null;
};
function lerRegistros(arq: string): Map<string, Registro[]> {
  const m = new Map<string, Registro[]>();
  if (!existsSync(arq)) return m;
  for (const linha of readFileSync(arq, "utf8").split("\n").filter(Boolean)) {
    const r = JSON.parse(linha) as Registro;
    if (!m.has(r.reuniao)) m.set(r.reuniao, []);
    m.get(r.reuniao)!.push(r);
  }
  return m;
}
const feitas = lerRegistros(arqDecisoes);
// --base: decisões de outro ensaio, usadas pras reuniões que este não reprocessa
// (assim a lista simulada de cada reunião escolhida fica igual à daquele ensaio).
const base = arg("base") ? lerRegistros(arg("base")!) : new Map<string, Registro[]>();
const arqUso = join(saida, "uso.jsonl");

// ─── simulação ───────────────────────────────────────────────────────
const naLista = new Map<string, Linha>();
let proxManual = 0;
let processadas = 0;
const DIA = 86_400_000;

for (const r of reunioes) {
  const T = r.em;
  while (proxManual < manuais.length && manuais[proxManual].created_at <= T) {
    naLista.set(manuais[proxManual].id, manuais[proxManual]);
    proxManual++;
  }

  let registros = feitas.get(r.id);
  const pular = soReunioes.size > 0 && !soReunioes.has(r.id);
  if (!registros && !pular && processadas < limite) {
    const tMs = Date.parse(T);
    const candidatas: Candidata[] = [];
    const vetoresCandidatas = new Map<string, number[]>();
    for (const l of naLista.values()) {
      const concluidaAntes = l.concluida_em && l.concluida_em < T;
      if (concluidaAntes && Date.parse(l.concluida_em!) < tMs - DIAS_CONCLUIDA * DIA) continue;
      candidatas.push({
        id: l.id,
        titulo: l.titulo,
        descricao: l.descricao,
        owner: l.owner,
        status: concluidaAntes ? "concluida" : l.status === "concluida" ? "aberta" : l.status,
        criada_em: l.created_at,
        reuniao_em: l.reuniao_em,
        concluida_em: concluidaAntes ? l.concluida_em : null,
      });
      vetoresCandidatas.set(l.id, vetorDe(l));
    }
    const inicio = Date.now();
    const res = await compararComExistentes({
      dataReuniao: T,
      novas: r.tarefas.map((t) => ({ titulo: t.titulo, descricao: t.descricao, owner: t.owner, evidencia: t.evidencia })),
      vetoresNovas: r.tarefas.map(vetorDe),
      candidatas,
      vetoresCandidatas,
    });
    const porId = new Map(candidatas.map((c) => [c.id, c]));
    registros = r.tarefas.map((t, i) => {
      const d = res.decisoes[i];
      const alvo = d.tipo === "nova" ? null : porId.get(d.tarefaId)!;
      const sim = alvo ? res.mostradas[i].find((m) => m.id === alvo.id)?.similaridade ?? null : null;
      return {
        reuniao: r.id,
        reuniao_em: T,
        tarefa: t.id,
        titulo: t.titulo,
        tipo: d.tipo,
        votos: d.votos,
        alvo: alvo?.id ?? null,
        alvo_titulo: alvo?.titulo ?? null,
        alvo_status: alvo?.status ?? null,
        alvo_em: alvo?.reuniao_em ?? alvo?.criada_em ?? null,
        similaridade: sim,
        mais_parecida: res.mostradas[i][0]?.similaridade ?? null,
      };
    });
    for (const reg of registros) appendFileSync(arqDecisoes, JSON.stringify(reg) + "\n");
    appendFileSync(
      arqUso,
      JSON.stringify({ reuniao: r.id, candidatas: candidatas.length, ms: Date.now() - inicio, ...res.uso }) + "\n",
    );
    processadas++;
    const c = { nova: 0, mesma: 0, duvida: 0 };
    registros.forEach((x) => c[x.tipo]++);
    console.log(
      `${T.slice(0, 10)} ${r.id.slice(0, 8)} tarefas=${r.tarefas.length} lista=${candidatas.length} ` +
        `nova=${c.nova} mesma=${c.mesma} duvida=${c.duvida} ${Math.round((Date.now() - inicio) / 1000)}s` +
        (res.uso.falhas ? ` FALHAS=${res.uso.falhas}` : ""),
    );
  }

  // O que foi juntado não vira card; o resto entra na lista simulada.
  const juntadas = new Set((registros ?? base.get(r.id) ?? []).filter((x) => x.tipo === "mesma").map((x) => x.tarefa));
  for (const t of r.tarefas) if (!juntadas.has(t.id)) naLista.set(t.id, t);
}

console.log(`fim. reuniões processadas agora: ${processadas}`);
