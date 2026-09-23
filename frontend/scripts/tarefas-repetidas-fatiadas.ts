// Gravação longa fatiada: acha, entre as tarefas da gravação inteira, as que
// as partes já criaram de novo (a mesma tarefa, pela comparação de 3 leituras).
//
// Só LÊ um JSON exportado e escreve: pares.json (o que achou) e aplicar.sql
// (cancela a tarefa da gravação inteira que tem par e ninguém mexeu). O SQL
// confere de novo, na hora de aplicar, que a tarefa segue aberta e intocada.
//
// Uso:
//   OPENAI_API_KEY=... bun scripts/tarefas-repetidas-fatiadas.ts --dados tarefas.json --saida pasta/
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compararComExistentes, vetorizar, textoParaVetor, type Candidata } from "../lib/tarefas-repetidas";

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
  em_quadros: number;
  no_plano: boolean;
  mexida: boolean;
  coach: boolean;
};

function arg(nome: string): string {
  const i = process.argv.indexOf(`--${nome}`);
  if (i < 0) throw new Error(`falta --${nome}`);
  return process.argv[i + 1];
}

const linhas = JSON.parse(readFileSync(arg("dados"), "utf8")) as Linha[];
const saida = arg("saida");
mkdirSync(saida, { recursive: true });

const pais = [...new Set(linhas.filter((l) => l.meeting_status === "archived_session").map((l) => l.meeting_id!))];
const pares: {
  pai: string;
  tarefa_pai: string;
  titulo_pai: string;
  tipo: string;
  votos: number;
  tarefa_parte: string | null;
  titulo_parte: string | null;
  mexida: boolean;
  status_pai: string;
}[] = [];

for (const pai of pais) {
  const doPai = linhas.filter((l) => l.meeting_id === pai);
  const dasPartes = linhas.filter((l) => l.parent_meeting_id === pai);
  // Aqui a pergunta é só "a parte já criou essa mesma tarefa?": o status da
  // tarefa da parte (feita ou não) não muda a resposta.
  const candidatas: Candidata[] = dasPartes.map((l) => ({
    id: l.id,
    titulo: l.titulo,
    descricao: l.descricao,
    owner: l.owner,
    status: "aberta",
    criada_em: l.created_at,
    reuniao_em: l.reuniao_em,
    concluida_em: null,
  }));
  const vetores = await vetorizar([...doPai, ...dasPartes].map((l) => textoParaVetor(l)));
  const vetoresCandidatas = new Map(dasPartes.map((l, i) => [l.id, vetores[doPai.length + i]]));
  const r = await compararComExistentes({
    dataReuniao: doPai[0]?.reuniao_em ?? null,
    novas: doPai.map((l) => ({ titulo: l.titulo, descricao: l.descricao, owner: l.owner, evidencia: l.evidencia })),
    vetoresNovas: vetores.slice(0, doPai.length),
    candidatas,
    vetoresCandidatas,
  });
  doPai.forEach((l, i) => {
    const d = r.decisoes[i];
    const parte = d.tipo === "nova" ? null : dasPartes.find((x) => x.id === d.tarefaId) ?? null;
    pares.push({
      pai,
      tarefa_pai: l.id,
      titulo_pai: l.titulo,
      tipo: d.tipo,
      votos: d.votos,
      tarefa_parte: parte?.id ?? null,
      titulo_parte: parte?.titulo ?? null,
      mexida: l.mexida || l.em_quadros > 0 || l.no_plano || l.coach,
      status_pai: l.status,
    });
  });
  console.log(
    `${pai.slice(0, 8)}: ${doPai.length} tarefas da gravação inteira, ${dasPartes.length} das partes → ` +
      `mesma=${r.decisoes.filter((d) => d.tipo === "mesma").length} duvida=${r.decisoes.filter((d) => d.tipo === "duvida").length}`,
  );
}

writeFileSync(join(saida, "pares.json"), JSON.stringify(pares, null, 2));

const sai = pares.filter((p) => p.tipo === "mesma" && !p.mexida && p.status_pai === "aberta");
const sql = [
  "BEGIN;",
  "SET LOCAL app.current_user_id = '7740e829-9462-416b-81a1-b787e23ba9b2';",
  ...sai.flatMap((p) => [
    `WITH c AS (
  UPDATE tarefas t SET status = 'cancelada', cancelada_em = now(), situacao_desde = now()
   WHERE t.id = '${p.tarefa_pai}' AND t.status = 'aberta' AND NOT t.no_plano
     AND NOT EXISTS (SELECT 1 FROM quadro_tarefas q WHERE q.tarefa_id = t.id)
     AND NOT EXISTS (SELECT 1 FROM tarefa_eventos e WHERE e.tarefa_id = t.id AND e.evento <> 'criada')
     AND NOT EXISTS (SELECT 1 FROM tarefa_anexos a WHERE a.tarefa_id = t.id)
     AND NOT EXISTS (SELECT 1 FROM coach_commitments cc WHERE cc.tarefa_id = t.id)
  RETURNING t.id)
INSERT INTO tarefa_eventos (tarefa_id, evento, payload)
SELECT id, 'cancelada', '${JSON.stringify({ motivo: "gravacao_fatiada", principal_id: p.tarefa_parte })}'::jsonb FROM c;`,
  ]),
  "COMMIT;",
].join("\n");
writeFileSync(join(saida, "aplicar.sql"), sql + "\n");
console.log(
  `saem: ${sai.length} · com par mas mexidas (mostrar ao Vitor): ${pares.filter((p) => p.tipo === "mesma" && p.mexida).length} · ` +
    `dúvida: ${pares.filter((p) => p.tipo === "duvida").length} · sem par: ${pares.filter((p) => p.tipo === "nova").length}`,
);
