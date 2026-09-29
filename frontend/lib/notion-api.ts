// Conversa com a API do Notion (versão 2025-09-03: as bases têm "fontes de dados" e é nelas
// que se consulta e cria página). Limite do Notion: ~3 pedidos por segundo por conexão; em
// 429 espera o Retry-After e tenta de novo.
import type { PaginaNotion } from "./notion-mapa";

const API = "https://api.notion.com/v1";
const VERSAO = "2025-09-03";

export class ErroDoNotion extends Error {
  constructor(
    public status: number,
    public codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

async function pedir<T>(
  token: string,
  caminho: string,
  init: { method?: string; json?: unknown; form?: FormData } = {},
  tentativa = 0,
): Promise<T> {
  const r = await fetch(`${API}${caminho}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": VERSAO,
      ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (r.status === 429 && tentativa < 3) {
    const espera = Math.min(Number(r.headers.get("retry-after") || "1"), 20) * 1000;
    await new Promise((ok) => setTimeout(ok, espera));
    return pedir<T>(token, caminho, init, tentativa + 1);
  }
  if (!r.ok) {
    const corpo = (await r.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new ErroDoNotion(r.status, corpo?.code ?? "erro", corpo?.message ?? `Notion respondeu ${r.status}`);
  }
  return (await r.json()) as T;
}

/** Quem é a conexão (o "robô" que aparece como autor das mudanças que o Ações faz). */
export function quemSouEu(token: string) {
  return pedir<{ id: string; name?: string; bot?: { workspace_name?: string } }>(token, "/users/me");
}

export async function lerBase(token: string, databaseId: string) {
  const b = await pedir<{ id: string; title?: { plain_text?: string }[]; data_sources?: { id: string; name?: string }[] }>(
    token,
    `/databases/${databaseId}`,
  );
  const nome = (b.title ?? []).map((t) => t.plain_text ?? "").join("").trim() || null;
  const fonte = b.data_sources?.[0]?.id;
  if (!fonte) throw new ErroDoNotion(400, "sem_fonte", "A base do Notion não tem fonte de dados.");
  return { nome, dataSourceId: fonte };
}

/** As propriedades de uma fonte de dados (pra achar a base Projects pela coluna Project). */
export function lerFonte(token: string, dataSourceId: string) {
  return pedir<{ id: string; properties: Record<string, { type?: string; relation?: { data_source_id?: string } }> }>(
    token,
    `/data_sources/${dataSourceId}`,
  );
}

/** Páginas editadas desde `desde` (ou todas), da mais antiga pra mais nova. */
export async function paginasEditadas(token: string, dataSourceId: string, desde: string | null): Promise<PaginaNotion[]> {
  const out: PaginaNotion[] = [];
  let cursor: string | undefined;
  do {
    const r = await pedir<{ results: PaginaNotion[]; has_more: boolean; next_cursor: string | null }>(
      token,
      `/data_sources/${dataSourceId}/query`,
      {
        method: "POST",
        json: {
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
          ...(desde ? { filter: { timestamp: "last_edited_time", last_edited_time: { on_or_after: desde } } } : {}),
          sorts: [{ timestamp: "last_edited_time", direction: "ascending" }],
        },
      },
    );
    out.push(...r.results);
    cursor = r.has_more && r.next_cursor ? r.next_cursor : undefined;
  } while (cursor && out.length < 2000);
  return out;
}

export function criarPagina(token: string, dataSourceId: string, propriedades: Record<string, unknown>, nota: string | null) {
  return pedir<PaginaNotion>(token, "/pages", {
    method: "POST",
    json: {
      parent: { type: "data_source_id", data_source_id: dataSourceId },
      properties: propriedades,
      ...(nota
        ? { children: [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: nota } }] } }] }
        : {}),
    },
  });
}

export function mudarPagina(token: string, pageId: string, mudanca: { properties?: Record<string, unknown>; in_trash?: boolean }) {
  return pedir<PaginaNotion>(token, `/pages/${pageId}`, { method: "PATCH", json: mudanca });
}

export function lerPaginaDoNotion(token: string, pageId: string) {
  return pedir<PaginaNotion>(token, `/pages/${pageId}`);
}

/** Uma pessoa do Notion (nome e e-mail: a conexão lê e-mail). */
export function lerPessoa(token: string, userId: string) {
  return pedir<{ id: string; name?: string | null; type?: string; person?: { email?: string } }>(token, `/users/${userId}`);
}

export type ComentarioDoNotion = {
  id: string;
  discussion_id: string;
  created_time: string;
  created_by: { id: string };
  rich_text: { plain_text?: string; text?: { content?: string } }[];
};

/** Os comentários de uma página (as discussões dela), do mais antigo pro mais novo. */
export async function comentariosDaPagina(token: string, pageId: string): Promise<ComentarioDoNotion[]> {
  const out: ComentarioDoNotion[] = [];
  let cursor: string | undefined;
  do {
    const r = await pedir<{ results: ComentarioDoNotion[]; has_more: boolean; next_cursor: string | null }>(
      token,
      `/comments?block_id=${pageId}&page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`,
    );
    out.push(...r.results);
    cursor = r.has_more && r.next_cursor ? r.next_cursor : undefined;
  } while (cursor && out.length < 1000);
  return out;
}

/** Comenta na página (o autor lá é a conexão; o nome de quem escreveu vai no texto). */
export function comentarNaPagina(token: string, pageId: string, texto: string) {
  const pedacos: string[] = [];
  for (let i = 0; i < texto.length; i += 2000) pedacos.push(texto.slice(i, i + 2000));
  return pedir<ComentarioDoNotion>(token, "/comments", {
    method: "POST",
    json: { parent: { page_id: pageId }, rich_text: pedacos.map((content) => ({ type: "text", text: { content } })) },
  });
}

/** Sobe um arquivo pro Notion (até 20 MB, envio único) e devolve o id pra pôr na coluna de arquivos. */
export async function subirArquivo(token: string, nome: string, tipo: string, bytes: Uint8Array): Promise<string> {
  const criado = await pedir<{ id: string }>(token, "/file_uploads", {
    method: "POST",
    json: { filename: nome, content_type: tipo },
  });
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: tipo }), nome);
  await pedir<{ id: string; status?: string }>(token, `/file_uploads/${criado.id}/send`, { method: "POST", form });
  return criado.id;
}

export type BlocoDoNotion = {
  id: string;
  type: string;
  has_children?: boolean;
  [tipo: string]: unknown;
};

/** Os blocos de dentro de uma página (ou de um bloco), na ordem de lá. */
export async function blocosDaPagina(token: string, blockId: string, maximo = 200): Promise<BlocoDoNotion[]> {
  const out: BlocoDoNotion[] = [];
  let cursor: string | undefined;
  do {
    const r = await pedir<{ results: BlocoDoNotion[]; has_more: boolean; next_cursor: string | null }>(
      token,
      `/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`,
    );
    out.push(...r.results);
    cursor = r.has_more && r.next_cursor ? r.next_cursor : undefined;
  } while (cursor && out.length < maximo);
  return out.slice(0, maximo);
}
