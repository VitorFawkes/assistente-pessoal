// "Quem faz" escolhido na lista das telas do TTARS. Vem como e-mail de alguém da Welcome
// (ganha conta aqui se ainda não tem) ou "notion:<id>" de quem só existe no Notion do
// marketing (Angela, Fabí…). Se a pessoa é do marketing, a ação vai também pro Notion.
import { isTeamMode } from "./team-mode";
import { garantirColegaDoTtars } from "./equipe-compartilhado";
import { pessoaNotionPorUsuario, pessoasDoNotion } from "./notion-sync";

export type Escolha =
  | { erro: string }
  | { corpo: { responsavel_user_id?: string; owner?: string }; notionUserId: string | null };

export async function resolverEscolha(valor: unknown): Promise<Escolha | null> {
  if (!isTeamMode() || typeof valor !== "string" || !valor.trim()) return null;
  const v = valor.trim();
  if (v.startsWith("notion:")) {
    const id = v.slice("notion:".length);
    const p = (await pessoasDoNotion()).find((x) => x.notion_user_id === id);
    if (!p) return { erro: "Essa pessoa não está no Notion do marketing." };
    return p.user_id
      ? { corpo: { responsavel_user_id: p.user_id }, notionUserId: id }
      : { corpo: { owner: p.nome }, notionUserId: id };
  }
  const c = await garantirColegaDoTtars(v);
  if (!c) return { erro: "Essa pessoa não está na lista do TTARS." };
  return { corpo: { responsavel_user_id: c.id }, notionUserId: await pessoaNotionPorUsuario(c.id) };
}
