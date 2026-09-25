import Link from "next/link";
import { requireUserOrRedirect } from "@/lib/auth";
import { query } from "@/lib/db";
import { PERIODOS, usageReport, type Periodo } from "@/lib/ai-usage-report";
import { officialOpenAiCosts } from "@/lib/openai-costs";
import { atualizarGastos } from "./actions";

export const dynamic = "force-dynamic";

const TZ = "America/Sao_Paulo";

function usd(v: number): string {
  const digits = v >= 1 || v === 0 ? 2 : v >= 0.1 ? 3 : 4;
  return `US$ ${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v)}`;
}

function comparacao(total: number, anterior: number): string {
  if (!anterior) return "sem gasto registrado no período anterior";
  const diff = (total - anterior) / anterior;
  if (Math.abs(diff) < 0.05) return `igual ao período anterior (${usd(anterior)})`;
  return `${diff > 0 ? "+" : "−"}${Math.round(Math.abs(diff) * 100)}% em relação ao período anterior (${usd(anterior)})`;
}

const secao = "text-[11px] tracking-[0.16em] uppercase text-[color:var(--muted)]";

export default async function GastosPage({ searchParams }: { searchParams: Promise<{ periodo?: string }> }) {
  const user = await requireUserOrRedirect();
  const pedido = (await searchParams).periodo;
  const periodo: Periodo = pedido && pedido in PERIODOS ? (pedido as Periodo) : "7d";
  const r = await usageReport(periodo, TZ, user.id);
  const [oficial, registradoOpenAi] = await Promise.all([
    officialOpenAiCosts(r.de, r.ate),
    query<{ total: string }>(
      "SELECT coalesce(sum(cost_usd),0) AS total FROM ai_usage WHERE provider='openai' AND occurred_at>=date_trunc('day',$1::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AND occurred_at<$2",
      [r.de.toISOString(), r.ate.toISOString()],
    ).then((rows) => Number(rows[0]?.total) || 0),
  ]);
  const maxDia = Math.max(0, ...r.dias.map((d) => d.custo));
  const medidoPct = r.usos ? Math.round(((r.usos - r.estimados) / r.usos) * 100) : 100;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-[11px] tracking-[0.2em] uppercase text-[color:var(--muted)]">Admin</p>
        <h1 className="font-display text-3xl sm:text-4xl">Gastos com IA</h1>
        <p className="text-[13px] text-[color:var(--muted-strong)]">
          Quanto cada agente do Ações gastou, somando cada chamada paga, com o consumo que a própria IA informou e o
          preço oficial. Valores em dólar, de todas as pessoas.
        </p>
      </header>

      <nav className="flex flex-wrap gap-1.5 text-[13px]" aria-label="Período">
        {(Object.keys(PERIODOS) as Periodo[]).map((p) => (
          <Link
            key={p}
            href={`/admin/gastos?periodo=${p}`}
            aria-current={p === periodo ? "page" : undefined}
            className={
              p === periodo
                ? "px-3 py-1.5 rounded-full bg-[color:var(--foreground)] text-[color:var(--background)] font-medium"
                : "px-3 py-1.5 rounded-full border border-[color:var(--border)] text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)]"
            }
          >
            {PERIODOS[p].label}
          </Link>
        ))}
      </nav>

      <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-5 space-y-1">
        <div className="text-[13px] text-[color:var(--muted-strong)]">Total no período</div>
        <div className="font-display text-4xl">{usd(r.total)}</div>
        <div className="text-[13px] text-[color:var(--muted-strong)]">{comparacao(r.total, r.anterior)}</div>
        <div className="text-[13px] text-[color:var(--muted-strong)]">
          {new Intl.NumberFormat("pt-BR").format(r.usos)} chamadas · {medidoPct}% com consumo medido
          {r.estimados ? ` · ${r.estimados} estimadas (veja abaixo por quê)` : ""}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className={secao}>Por agente</h2>
        {r.agentes.length === 0 ? (
          <p className="text-sm text-[color:var(--muted-strong)]">Nenhum gasto registrado neste período.</p>
        ) : (
          <ul className="space-y-2">
            {r.agentes.map((a) => (
              <li key={a.agent} className="rounded-2xl border border-[color:var(--border)] p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{a.nome}</div>
                    <div className="text-xs text-[color:var(--muted-strong)]">{a.descricao}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-medium text-sm tabular-nums">{usd(a.custo)}</div>
                    <div className="text-xs text-[color:var(--muted-strong)] tabular-nums">
                      {a.usos} {a.usos === 1 ? "uso" : "usos"} · {usd(a.custo / Math.max(1, a.usos))} cada
                    </div>
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-[color:var(--accent)] overflow-hidden" aria-hidden>
                  <div className="h-full rounded-full bg-[color:var(--foreground)]/70" style={{ width: `${r.total ? Math.max(1, (a.custo / r.total) * 100) : 0}%` }} />
                </div>
                {a.estimados > 0 && (
                  <div className="text-[11px] text-[color:var(--muted)]">
                    {a.estimados === a.usos ? "Todas estimadas" : `${a.estimados} de ${a.usos} estimadas`}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {r.dias.length > 1 && (
        <section className="space-y-3">
          <h2 className={secao}>Por dia</h2>
          <div className="flex items-end gap-1 h-32 rounded-2xl border border-[color:var(--border)] p-3">
            {r.dias.map((d) => (
              <div key={d.dia} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full gap-1" title={`${d.dia.slice(8, 10)}/${d.dia.slice(5, 7)}: ${usd(d.custo)}`}>
                <div className="w-full rounded-t bg-[color:var(--foreground)]/70" style={{ height: `${maxDia ? Math.max(2, (d.custo / maxDia) * 100) : 0}%` }} />
                <div className="text-[9px] text-[color:var(--muted)] tabular-nums">{d.dia.slice(8, 10)}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className={secao}>Maiores gastos</h2>
        {r.maiores.length === 0 ? (
          <p className="text-sm text-[color:var(--muted-strong)]">Nada no período.</p>
        ) : (
          <ul className="divide-y divide-[color:var(--border)] rounded-2xl border border-[color:var(--border)]">
            {r.maiores.map((m, i) => (
              <li key={i} className="p-3 text-sm flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">{m.agente}</div>
                  <div className="text-xs text-[color:var(--muted-strong)] break-words">
                    {m.quando} · {m.model} · {m.detalhe}
                    {m.reuniao ? ` · ${m.reuniao}` : ""}
                  </div>
                  {m.basis === "estimado" && m.note && <div className="text-[11px] text-[color:var(--muted)]">Estimado: {m.note}</div>}
                </div>
                <div className="font-medium tabular-nums shrink-0">{usd(m.custo)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className={secao}>Por modelo</h2>
        <ul className="rounded-2xl border border-[color:var(--border)] divide-y divide-[color:var(--border)] text-sm">
          {r.modelos.map((m) => (
            <li key={`${m.provider}:${m.model}`} className="p-3 flex justify-between gap-3">
              <span className="min-w-0 break-words">
                {m.model} <span className="text-xs text-[color:var(--muted)]">({m.provider === "assemblyai" ? "AssemblyAI" : "OpenAI"}, {m.usos} usos)</span>
              </span>
              <span className="tabular-nums shrink-0">{usd(m.custo)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className={secao}>Conferência com a fatura da OpenAI</h2>
        {oficial.disponivel ? (
          <div className="rounded-2xl border border-[color:var(--border)] p-3 text-sm space-y-2">
            <div className="flex justify-between gap-3">
              <span>Registrado aqui (chamadas à OpenAI)</span>
              <span className="tabular-nums">{usd(registradoOpenAi)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span>Fatura oficial, todos os projetos ({oficial.de} a {oficial.ate}, dias em UTC)</span>
              <span className="tabular-nums">{usd(oficial.total)}</span>
            </div>
            <ul className="text-xs text-[color:var(--muted-strong)] space-y-0.5">
              {oficial.projetos.map((p) => (
                <li key={p.nome} className="flex justify-between gap-3">
                  <span>{p.nome}</span>
                  <span className="tabular-nums">{usd(p.custo)}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-[color:var(--muted)]">
              A fatura inclui o que não passa pelo Ações: testes feitos fora do app e outros robôs que usam as mesmas
              chaves. A fatura leva algumas horas para fechar o dia.
            </p>
          </div>
        ) : (
          <p className="text-sm text-[color:var(--muted-strong)]">Desligada: {oficial.motivo}.</p>
        )}
      </section>

      <section className="space-y-2 text-xs text-[color:var(--muted-strong)]">
        <h2 className={secao}>Como é medido</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Cada chamada paga fica registrada uma vez, com o consumo que a própria IA devolveu e o preço oficial do dia 25/09/2026. O registro não é apagado nem alterado, nem quando o Coach é zerado.</li>
          <li>Relatório e tarefas das reuniões são lidos do n8n a cada 15 minutos. Nas etapas em que o n8n não informa o que veio do cache, a entrada é contada pelo preço cheio (pode ficar um pouco acima do real).</li>
          <li>Transcrição (AssemblyAI) é cobrada pela duração do áudio enviado, que vai sem os silêncios. A duração é a da última fala da reunião.</li>
          <li>Registro completo desde {r.registroDesde ?? "—"}. Antes disso, só o Coach tinha registro. O n8n guarda cerca de 2 semanas, então a leitura das reuniões começa por aí.</li>
          <li>Última leitura do n8n: {r.leituraN8n ?? "ainda não houve"}.</li>
        </ul>
        <form action={atualizarGastos}>
          <button type="submit" className="mt-2 rounded-xl border border-[color:var(--border)] px-3 py-1.5 text-xs hover:bg-[color:var(--accent)] transition">
            Ler o n8n agora
          </button>
        </form>
      </section>
    </div>
  );
}
