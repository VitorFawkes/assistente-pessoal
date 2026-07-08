"use client";

import { useEffect, useRef, useState } from "react";
import {
  Paperclip,
  Link as LinkIcon,
  FileText,
  Image as ImageIcon,
  Table,
  Archive,
  Music,
  Film,
  File as FileIcon,
  Download,
  ExternalLink,
  X,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTaskMutations } from "@/lib/task-mutations";
import {
  MAX_FILE_BYTES,
  isAllowedFile,
  formatBytes,
  isProbablyUrl,
  linkLabel,
} from "@/lib/anexos";
import type { Tarefa, TarefaAnexo } from "@/lib/queries";

const THUMB_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
]);

function iconFor(a: TarefaAnexo) {
  const ct = a.content_type ?? "";
  if (ct.startsWith("image/")) return ImageIcon;
  if (ct === "application/pdf") return FileText;
  if (ct.startsWith("audio/")) return Music;
  if (ct.startsWith("video/")) return Film;
  if (/(spreadsheet|excel|csv|ms-excel|numbers)/.test(ct)) return Table;
  if (/(zip|rar|7z|tar|gzip|compressed)/.test(ct)) return Archive;
  if (/(word|document|text|rtf|presentation|powerpoint|pdf|keynote|pages)/.test(ct))
    return FileText;
  return FileIcon;
}

// Screenshots colados vêm sem nome → sintetiza um com extensão pela mime.
function extFromType(t: string): string {
  const m: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "application/pdf": "pdf",
  };
  return m[t] || "";
}
function ensureNamed(file: File): File {
  if (file.name && isAllowedFile(file.name)) return file;
  const ext = extFromType(file.type) || "png";
  const name = `colado-${Date.now()}.${ext}`;
  return new File([file], name, { type: file.type || "image/png" });
}

export function TaskAnexos({ tarefa }: { tarefa: Tarefa }) {
  const mut = useTaskMutations();
  const [anexos, setAnexos] = useState<TarefaAnexo[]>(tarefa.anexos ?? []);
  const [text, setText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(0); // uploads em andamento
  const fileRef = useRef<HTMLInputElement>(null);

  // Reconcilia com a prop quando ela muda de fora (ex.: router.refresh do dono
  // após editar outro campo). Não clobbera as adições otimistas porque elas não
  // disparam mudança de prop.
  useEffect(() => {
    setAnexos(tarefa.anexos ?? []);
  }, [tarefa.anexos]);

  const addLink = async () => {
    if (!isProbablyUrl(text)) return;
    const val = text.trim();
    setText("");
    const created = await mut.anexos.addLink(tarefa.id, val);
    if (created) {
      setAnexos((a) => [...a, created]);
      mut.refresh(); // sincroniza o prop do servidor → sobrevive a fechar/reabrir
    } else {
      setText(val); // devolve o texto se falhou
    }
  };

  const uploadFiles = async (files: File[]) => {
    let added = false;
    for (const raw of files) {
      const file = ensureNamed(raw);
      if (!isAllowedFile(file.name)) {
        // toast.error do lado do mut só cobre erro de rede; aqui é validação local
        const { toast } = await import("sonner");
        toast.error(`Formato não suportado: ${file.name}`);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        const { toast } = await import("sonner");
        toast.error(`${file.name} passa de ${formatBytes(MAX_FILE_BYTES)}`);
        continue;
      }
      setBusy((n) => n + 1);
      const created = await mut.anexos.upload(tarefa.id, file);
      setBusy((n) => n - 1);
      if (created) {
        setAnexos((a) => [...a, created]);
        added = true;
      }
    }
    if (added) mut.refresh(); // persiste no prop → visível ao reabrir e recarregar
  };

  const remove = async (id: string) => {
    const prev = anexos;
    setAnexos((a) => a.filter((x) => x.id !== id));
    const ok = await mut.anexos.remove(tarefa.id, id);
    if (!ok) setAnexos(prev); // restaura se falhou
    else mut.refresh();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) uploadFiles(files);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files || []);
    if (files.length) {
      e.preventDefault();
      uploadFiles(files);
    }
    // texto (URL) segue no input; o usuário aperta Enter pra virar link
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={(e) => {
        // só desliga se saiu do container (não de um filho)
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={onDrop}
      className={cn(
        "rounded-lg border border-dashed transition",
        dragOver
          ? "border-[color:var(--calm)] bg-[color:var(--calm)]/5"
          : "border-[color:var(--border)]",
      )}
    >
      {/* lista de anexos */}
      {anexos.length > 0 && (
        <ul className="divide-y divide-[color:var(--border)]">
          {anexos.map((a) =>
            a.tipo === "link" ? (
              <li key={a.id} className="flex items-center gap-2 px-2.5 py-2 group">
                <LinkIcon size={15} className="shrink-0 text-[color:var(--calm)]" />
                <a
                  href={a.url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 min-w-0 truncate text-[13px] text-[color:var(--foreground)] hover:underline"
                  title={a.url ?? undefined}
                >
                  {linkLabel(a.url ?? "", a.titulo)}
                </a>
                <a
                  href={a.url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
                  aria-label="Abrir link"
                >
                  <ExternalLink size={14} />
                </a>
                <RemoveBtn onClick={() => remove(a.id)} />
              </li>
            ) : (
              <li key={a.id} className="flex items-center gap-2.5 px-2.5 py-2 group">
                {a.content_type && THUMB_TYPES.has(a.content_type) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mut.anexos.downloadHref(tarefa.id, a.id)}
                    alt={a.filename ?? ""}
                    className="shrink-0 w-9 h-9 rounded object-cover border border-[color:var(--border)] bg-[color:var(--accent)]"
                  />
                ) : (
                  <span className="shrink-0 w-9 h-9 rounded border border-[color:var(--border)] bg-[color:var(--accent)] flex items-center justify-center text-[color:var(--muted-strong)]">
                    {(() => {
                      const Icon = iconFor(a);
                      return <Icon size={16} />;
                    })()}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <p className="truncate text-[13px] text-[color:var(--foreground)]">
                    {a.titulo || a.filename}
                  </p>
                  <p className="text-[11px] text-[color:var(--muted)]">
                    {formatBytes(a.size_bytes)}
                  </p>
                </div>
                <a
                  href={mut.anexos.downloadHref(tarefa.id, a.id, { download: true })}
                  download={a.filename ?? true}
                  className="shrink-0 inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-[color:var(--border)] text-[color:var(--muted-strong)] hover:bg-[color:var(--accent)] transition"
                  aria-label={`Baixar ${a.filename}`}
                >
                  <Download size={13} />
                  baixar
                </a>
                <RemoveBtn onClick={() => remove(a.id)} />
              </li>
            ),
          )}
        </ul>
      )}

      {/* barra de adição */}
      <div
        className={cn(
          "flex items-center gap-1.5 px-2 py-1.5",
          anexos.length > 0 && "border-t border-[color:var(--border)]",
        )}
      >
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addLink();
            }
          }}
          placeholder="Cole um link e Enter · ou solte / ⌘V um arquivo"
          className="flex-1 min-w-0 bg-transparent px-1.5 py-1 text-[13px] focus:outline-none placeholder:text-[color:var(--muted)]"
        />
        {isProbablyUrl(text) && (
          <button
            type="button"
            onClick={addLink}
            className="shrink-0 text-[11px] px-2 py-1 rounded-full bg-[color:var(--calm)] text-white font-medium hover:opacity-90"
          >
            + link
          </button>
        )}
        {busy > 0 && (
          <Loader2 size={15} className="shrink-0 animate-spin text-[color:var(--muted)]" />
        )}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="shrink-0 p-1.5 rounded-full text-[color:var(--muted)] hover:text-[color:var(--foreground)] hover:bg-[color:var(--accent)] transition"
          aria-label="Anexar arquivo"
          title="Anexar arquivo"
        >
          <Paperclip size={15} />
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length) uploadFiles(files);
            e.target.value = ""; // permite re-anexar o mesmo arquivo
          }}
        />
      </div>
    </div>
  );
}

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 p-1 rounded-full text-[color:var(--muted)] opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-[color:var(--urgent)] hover:bg-[color:var(--urgent)]/10 transition"
      aria-label="Remover anexo"
    >
      <X size={14} />
    </button>
  );
}
