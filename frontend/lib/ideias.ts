// Ideias do quadro: lugar solto pra jogar o que a gente está pensando, sem
// prazo e sem dono. Quando amadurece, vira tarefa.
import { withTenant } from "./db";

export type Ideia = {
  id: string;
  quadro_id: string;
  texto: string;
  autor_nome: string;
  autor_convidado_id: string | null;
  frente_id: string | null;
  tema: string | null;
  tarefa_id: string | null;
  apoios: number;
  apoiei: boolean;
  criado_em: string;
};

const SELECT_IDEIA = `
  SELECT i.id, i.quadro_id, i.texto, i.autor_nome, i.autor_convidado_id,
         i.frente_id, f.nome AS tema, i.tarefa_id,
         to_char(i.criado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS criado_em,
         (SELECT count(*) FROM quadro_ideia_apoios a WHERE a.ideia_id = i.id)::int AS apoios,
         EXISTS (SELECT 1 FROM quadro_ideia_apoios a WHERE a.ideia_id = i.id AND a.quem = $2) AS apoiei
    FROM quadro_ideias i
    LEFT JOIN frentes f ON f.id = i.frente_id
   WHERE i.quadro_id = $1 AND i.arquivado_em IS NULL
   ORDER BY i.criado_em DESC`;

export const ideiasFor = (userId: string) => ({
  list: (quadroId: string, quem: string) =>
    withTenant(userId, async (c) => {
      const r = await c.query<Ideia>(SELECT_IDEIA, [quadroId, quem]);
      return r.rows;
    }),
});

/** Usada tanto pelo dono quanto pelo convidado (o client já vem escopado). */
export async function listarIdeias(c: { query: (q: string, p: unknown[]) => Promise<{ rows: Ideia[] }> }, quadroId: string, quem: string) {
  const r = await c.query(SELECT_IDEIA, [quadroId, quem]);
  return r.rows;
}
