/**
 * The OpenAI invoice itself, per project and day (Costs API). Needs an organization admin key in OPENAI_ADMIN_KEY;
 * the regular key cannot read billing. Days are UTC, as on the OpenAI dashboard.
 */
export type OfficialCosts = { disponivel: false; motivo: string } | { disponivel: true; projetos: { nome: string; custo: number }[]; total: number; de: string; ate: string };

export async function officialOpenAiCosts(from: Date, to: Date): Promise<OfficialCosts> {
 const key = process.env.OPENAI_ADMIN_KEY;
 if (!key) return { disponivel: false, motivo: "falta a chave de administrador da OpenAI" };
 const headers = { Authorization: `Bearer ${key}` };
 const start = Math.floor(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()) / 1000);
 const end = Math.ceil(to.getTime() / 1000);
 try {
  const byProject = new Map<string, number>();
  let page: string | undefined;
  for (let i = 0; i < 10; i++) {
   const url = `https://api.openai.com/v1/organization/costs?start_time=${start}&end_time=${end}&bucket_width=1d&group_by=project_id&limit=180${page ? `&page=${encodeURIComponent(page)}` : ""}`;
   const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
   if (!res.ok) return { disponivel: false, motivo: `a OpenAI recusou a leitura da fatura (${res.status})` };
   const body = (await res.json()) as { data?: { results?: { amount?: { value?: number }; project_id?: string | null }[] }[]; has_more?: boolean; next_page?: string };
   for (const bucket of body.data ?? []) for (const r of bucket.results ?? []) byProject.set(r.project_id ?? "sem projeto", (byProject.get(r.project_id ?? "sem projeto") ?? 0) + Number(r.amount?.value ?? 0));
   if (!body.has_more || !body.next_page) break;
   page = body.next_page;
  }
  const names = new Map<string, string>();
  const projects = await fetch("https://api.openai.com/v1/organization/projects?limit=100&include_archived=true", { headers, signal: AbortSignal.timeout(20_000) }).then(r => r.ok ? r.json() : null).catch(() => null) as { data?: { id: string; name: string }[] } | null;
  for (const p of projects?.data ?? []) names.set(p.id, p.name);
  const projetos = [...byProject].map(([id, custo]) => ({ nome: names.get(id) ?? id, custo })).filter(p => p.custo > 0).sort((a, b) => b.custo - a.custo);
  return { disponivel: true, projetos, total: projetos.reduce((s, p) => s + p.custo, 0), de: new Date(start * 1000).toISOString().slice(0, 10), ate: to.toISOString().slice(0, 10) };
 } catch {
  return { disponivel: false, motivo: "a leitura da fatura da OpenAI falhou agora" };
 }
}
