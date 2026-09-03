"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Copy, Check, FileText, Captions, FileCode, Printer } from "lucide-react";
import { toPlainText, filterBySection, type Segment } from "@/lib/transcript-format";
import { summaryToPlainText } from "@/lib/summary-format";

type Conteudo = "resumo" | "transcricao" | "completo";
type Formato = "pdf" | "txt" | "md" | "srt" | "vtt";

// Um botão só. Dentro dele, duas perguntas na ordem em que a pessoa pensa:
// primeiro O QUE ela quer, depois COMO. O menu antigo era uma lista de 11
// links onde "Texto (.txt)" aparecia três vezes com significados diferentes —
// só o título da seção acima dizia qual era qual.
const CONTEUDOS: { id: Conteudo; label: string; artigo: string }[] = [
  { id: "resumo", label: "Só o resumo", artigo: "o resumo" },
  { id: "transcricao", label: "Só a transcrição", artigo: "a transcrição" },
  { id: "completo", label: "Os dois juntos", artigo: "o resumo + a transcrição" },
];

type FormatoDef = {
  id: Formato;
  label: string;
  hint: string;
  icon: typeof FileText;
  soTranscricao?: boolean;
};

const FORMATOS: FormatoDef[] = [
  { id: "pdf", label: "PDF", hint: "pra ler, imprimir ou mandar", icon: Printer },
  { id: "txt", label: "Texto (.txt)", hint: "abre em qualquer lugar", icon: FileText },
  { id: "md", label: "Markdown (.md)", hint: "pra colar no Notion", icon: FileCode },
  {
    id: "srt",
    label: "Legenda (.srt)",
    hint: "pra colocar num vídeo",
    icon: Captions,
    soTranscricao: true,
  },
  {
    id: "vtt",
    label: "Legenda (.vtt)",
    hint: "legenda pra site",
    icon: Captions,
    soTranscricao: true,
  },
];

export function MeetingExportMenu({
  segments,
  labels,
  sections = [],
  summaryMd = null,
  duracao = 0,
  exportBase,
  printBase,
  label = "baixar",
}: {
  segments: Segment[];
  labels: Record<string, string>;
  sections?: { start_seconds: number; title: string }[];
  summaryMd?: string | null;
  /** Duração em segundos — fecha o intervalo do último trecho na cópia. */
  duracao?: number;
  /** Rota que devolve o arquivo (dono: /api/meetings/[id]/export). */
  exportBase: string;
  /** Página de impressão que vira PDF (dono: /reunioes/[id]/imprimir). */
  printBase: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const temResumo = !!summaryMd;
  const temTranscricao = segments.length > 0;

  const [conteudoEscolhido, setConteudo] = useState<Conteudo>(
    temResumo ? "resumo" : "transcricao",
  );
  // null = a transcrição inteira. Só aparece quando a reunião tem trechos.
  const [trechoEscolhido, setTrecho] = useState<number | null>(null);
  const [formatoEscolhido, setFormato] = useState<Formato>("pdf");

  const conteudoOk = (c: Conteudo) =>
    c === "resumo" ? temResumo : c === "transcricao" ? temTranscricao : temResumo && temTranscricao;

  // Escolha inválida vira escolha válida na hora de desenhar, sem effect: com
  // "só o resumo" a Legenda some da lista, e o link não pode continuar
  // prometendo um .srt que a rota recusaria (422).
  const conteudo: Conteudo = conteudoOk(conteudoEscolhido)
    ? conteudoEscolhido
    : temResumo
      ? "resumo"
      : "transcricao";
  const trecho = conteudo === "transcricao" ? trechoEscolhido : null;
  const formatos = FORMATOS.filter((f) => !f.soTranscricao || conteudo === "transcricao");
  const formato: Formato = formatos.some((f) => f.id === formatoEscolhido)
    ? formatoEscolhido
    : "pdf";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const qs = new URLSearchParams({ content: conteudo });
  if (trecho !== null) {
    qs.set("scope", "section");
    qs.set("section", String(trecho));
  }

  const href =
    formato === "pdf"
      ? `${printBase}?${qs.toString()}`
      : `${exportBase}?${qs.toString()}&format=${formato}`;

  const nomeFormato = FORMATOS.find((f) => f.id === formato)?.label ?? "";
  const trechoTitulo = trecho !== null ? sections[trecho]?.title : null;
  const nomeConteudo = trechoTitulo
    ? `o trecho “${trechoTitulo}”`
    : (CONTEUDOS.find((c) => c.id === conteudo)?.artigo ?? "");

  function textoAtual(): string {
    // O fim do último trecho é a duração da reunião; sem ela o corte fecha em
    // zero e a cópia sai vazia.
    const fim = duracao || segments.reduce((max, s) => Math.max(max, s.end), 0);
    const segs =
      trecho !== null ? filterBySection(segments, sections, trecho, fim) : segments;
    const resumo = summaryToPlainText(summaryMd || "");
    if (conteudo === "resumo") return resumo;
    if (conteudo === "transcricao") return toPlainText(segs, labels);
    return `${resumo}\n\nTRANSCRIÇÃO\n\n${toPlainText(segs, labels)}`;
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(textoAtual());
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard indisponível — ignora
    }
  }

  if (!temResumo && !temTranscricao) return null;

  const OPCAO = "flex items-center gap-2 text-left text-[13px] px-2.5 py-2 rounded-lg border transition";
  const ativa = "border-[color:var(--foreground)]/35 bg-[color:var(--accent)] font-medium";
  const inativa = "border-[color:var(--border)] hover:bg-[color:var(--accent)]/60";

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="press-feedback inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full bg-[color:var(--accent)] text-[color:var(--muted-strong)] hover:ring-1 hover:ring-[color:var(--foreground)]/30"
        title="Baixar o resumo ou a transcrição"
      >
        <Download size={13} /> {label}
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-30 paper-card rounded-xl border border-[color:var(--border)] shadow-lg p-3 w-[min(20rem,calc(100vw-2rem))] max-h-[75vh] overflow-y-auto space-y-4">
          <div className="space-y-1.5">
            <p className="text-[10px] tracking-[0.16em] uppercase text-[color:var(--muted)]">
              1. o que você quer
            </p>
            <div className="flex flex-col gap-1">
              {CONTEUDOS.filter((c) => conteudoOk(c.id)).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setConteudo(c.id)}
                  className={`${OPCAO} ${conteudo === c.id ? ativa : inativa}`}
                >
                  <span
                    className={`h-3.5 w-3.5 shrink-0 rounded-full border flex items-center justify-center ${
                      conteudo === c.id
                        ? "border-[color:var(--foreground)]"
                        : "border-[color:var(--border)]"
                    }`}
                  >
                    {conteudo === c.id && (
                      <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--foreground)]" />
                    )}
                  </span>
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {conteudo === "transcricao" && sections.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] tracking-[0.16em] uppercase text-[color:var(--muted)]">
                quanto da transcrição
              </p>
              <select
                value={trecho === null ? "" : String(trecho)}
                onChange={(e) => setTrecho(e.target.value === "" ? null : Number(e.target.value))}
                className="w-full text-[13px] px-2.5 py-2 rounded-lg border border-[color:var(--border)] bg-transparent"
              >
                <option value="">a conversa inteira</option>
                {sections.map((s, i) => (
                  <option key={i} value={i}>
                    só o trecho: {s.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <p className="text-[10px] tracking-[0.16em] uppercase text-[color:var(--muted)]">
              2. em qual formato
            </p>
            <div className="flex flex-col gap-1">
              {formatos.map((f) => {
                const Icon = f.icon;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFormato(f.id)}
                    className={`${OPCAO} ${formato === f.id ? ativa : inativa}`}
                  >
                    <Icon size={14} className="shrink-0 text-[color:var(--muted)]" />
                    <span className="flex-1 min-w-0">
                      {f.label}
                      <span className="block text-[11px] font-normal text-[color:var(--muted)] truncate">
                        {f.hint}
                      </span>
                    </span>
                    {formato === f.id && <Check size={14} className="shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* O botão fala o arquivo que vai sair. Antes, "Texto (.txt)" clicado
              na seção errada baixava a transcrição inteira sem avisar. */}
          <a
            href={href}
            {...(formato === "pdf"
              ? { target: "_blank", rel: "noopener noreferrer" }
              : { download: "" })}
            onClick={() => setOpen(false)}
            className="press-feedback flex items-center justify-center gap-2 text-center text-[13px] font-medium px-3 py-2.5 rounded-lg bg-[color:var(--foreground)] text-[color:var(--background)] hover:opacity-90"
          >
            <Download size={14} className="shrink-0" /> Baixar {nomeConteudo} em {nomeFormato}
          </a>

          <button
            type="button"
            onClick={copiar}
            className="w-full flex items-center justify-center gap-2 text-[12px] px-3 py-2 rounded-lg border border-[color:var(--border)] hover:bg-[color:var(--accent)]"
          >
            {copied ? (
              <>
                <Check size={13} className="text-[color:var(--calm)]" /> Copiado!
              </>
            ) : (
              <>
                <Copy size={13} /> Copiar esse texto
              </>
            )}
          </button>

          {formato === "pdf" && (
            <p className="text-[11px] leading-snug text-[color:var(--muted)]">
              O PDF abre numa aba e a janela de impressão aparece sozinha. Escolha
              &ldquo;Salvar como PDF&rdquo;.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
