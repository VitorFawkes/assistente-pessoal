"use client";

import { useState, useRef } from "react";
import { Upload, ChevronLeft } from "lucide-react";
import { toast } from "sonner";

const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB

export function FileUploader({ onClose, userId }: { onClose: () => void; userId: string }) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fileName, setFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function uploadFile(file: File) {
    const sessionId = crypto.randomUUID();
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    let uploadedChunks = 0;

    try {
      setUploading(true);
      setFileName(file.name);

      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);

        const formData = new FormData();
        formData.append("audio", chunk);
        formData.append("chunk_index", String(i));
        formData.append("total_chunks", String(totalChunks));

        let enviado = false;
        for (let tentativa = 1; tentativa <= 4 && !enviado; tentativa++) {
          const response = await fetch(`/api/gravacao/${sessionId}/pedaco?chunk=${i}&parte=0`, {
            method: "POST",
            body: formData,
          }).catch(() => null);
          enviado = !!response?.ok;
          if (!enviado) await new Promise((r) => setTimeout(r, tentativa * 2000));
        }
        if (!enviado) {
          throw new Error("A internet falhou no meio do envio. Tente de novo.");
        }

        uploadedChunks++;
        setProgress(Math.round((uploadedChunks / totalChunks) * 100));
      }

      // Finalize after all chunks
      const finalResponse = await fetch(`/api/gravacao/${sessionId}/fim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: file.name }),
      });

      if (!finalResponse.ok) {
        throw new Error("Não conseguimos processar este arquivo. Confira se é um áudio ou vídeo e tente de novo.");
      }

      toast.success("Pronto! A reunião aparece em Reuniões em poucos minutos.");
      setProgress(0);
      setFileName("");
      setUploading(false);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não conseguimos enviar o arquivo. Tente de novo.");
      setUploading(false);
    }
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <button
        onClick={onClose}
        className="flex items-center gap-2 text-sm text-[color:var(--muted)] hover:text-[color:var(--foreground)] transition"
      >
        <ChevronLeft size={16} />
        Voltar
      </button>

      <div className="text-center space-y-6">
        <div>
          <p className="text-sm text-[color:var(--muted)] mb-3">Subir arquivo</p>
          <p className="text-[color:var(--muted-strong)]">
            Áudio ou vídeo já gravado
          </p>
        </div>

        {!uploading ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                if (file) {
                  uploadFile(file);
                }
              }}
              className="hidden"
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-8 px-6 rounded-2xl border-2 border-dashed border-[color:var(--border)] bg-[color:var(--card)] hover:border-[color:var(--foreground)]/50 transition group"
            >
              <div className="flex flex-col items-center gap-3">
                <Upload className="w-8 h-8 text-[color:var(--muted-strong)] group-hover:text-[color:var(--foreground)] transition" />
                <div className="text-center">
                  <p className="font-medium text-[color:var(--foreground)]">
                    Clique para escolher
                  </p>
                  <p className="text-xs text-[color:var(--muted)] mt-1">
                    ou arraste um arquivo
                  </p>
                </div>
              </div>
            </button>

            <p className="text-xs text-[color:var(--muted)]">
              Funciona no Safari do iPhone também
            </p>
          </>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-[color:var(--foreground)]">{fileName}</p>

            <div className="space-y-2">
              <div className="h-3 bg-[color:var(--border)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[color:var(--foreground)] transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-[color:var(--muted-strong)] text-right">
                {progress}%
              </p>
            </div>

            <p className="text-xs text-[color:var(--muted)]">
              Fazendo upload do arquivo…
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
