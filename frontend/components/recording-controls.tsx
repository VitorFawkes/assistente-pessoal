"use client";

import { useEffect, useState, useRef } from "react";
import { Circle, Square, ChevronLeft } from "lucide-react";

export function RecordingControls({
  mode,
  recording,
  chunkCount,
  startTime,
  onStart,
  onStop,
  onBack,
}: {
  mode: "na-sala" | "online";
  recording: boolean;
  chunkCount: number;
  startTime: Date | null;
  onStart: () => void;
  onStop: () => void;
  onBack: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [levelValue, setLevelValue] = useState(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const animationRef = useRef<number | null>(null);

  // Timer
  useEffect(() => {
    if (!recording || !startTime) return;
    const interval = setInterval(() => {
      setElapsed(Date.now() - startTime.getTime());
    }, 100);
    return () => clearInterval(interval);
  }, [recording, startTime]);

  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const displaySeconds = seconds % 60;
  const displayMinutes = minutes % 60;

  const formatTime = () => {
    if (hours > 0) {
      return `${hours}:${String(displayMinutes).padStart(2, "0")}:${String(displaySeconds).padStart(2, "0")}`;
    }
    return `${displayMinutes}:${String(displaySeconds).padStart(2, "0")}`;
  };

  // Stop after 4 hours
  useEffect(() => {
    if (recording && seconds >= 4 * 3600) {
      onStop();
    }
  }, [recording, seconds, onStop]);

  const levelPercent = Math.min(100, Math.round((levelValue / 128) * 100));

  return (
    <div className="space-y-8 max-w-2xl">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-[color:var(--muted)] hover:text-[color:var(--foreground)] transition"
      >
        <ChevronLeft size={16} />
        Voltar
      </button>

      <div className="text-center">
        <p className="text-sm text-[color:var(--muted)] mb-3">
          {mode === "na-sala" ? "Reunião na sala" : "Reunião online"}
        </p>

        {recording ? (
          <div className="space-y-6">
            <div className="text-6xl font-mono font-semibold text-[color:var(--foreground)]">
              {formatTime()}
            </div>

            {/* Level Meter */}
            <div className="space-y-2">
              <p className="text-xs text-[color:var(--muted)]">Nível de áudio</p>
              <div className="h-2 bg-[color:var(--border)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[color:var(--foreground)] transition-all duration-75"
                  style={{ width: `${levelPercent}%` }}
                />
              </div>
            </div>

            {/* Chunk indicator */}
            <div className="text-sm text-[color:var(--muted-strong)]">
              {chunkCount} pedaço{chunkCount !== 1 ? "s" : ""} enviado{chunkCount !== 1 ? "s" : ""}
            </div>

            {/* Recording indicator */}
            <div className="flex justify-center">
              <div className="flex items-center gap-2 text-[color:var(--urgent)]">
                <Circle className="w-3 h-3 fill-[color:var(--urgent)] animate-pulse" />
                <span className="text-xs font-medium">Gravando…</span>
              </div>
            </div>

            {/* Stop button */}
            <button
              onClick={onStop}
              className="w-full py-4 px-6 rounded-lg bg-[color:var(--urgent)] text-white font-semibold hover:opacity-90 transition flex items-center justify-center gap-2"
            >
              <Square className="w-5 h-5" />
              Parar
            </button>
          </div>
        ) : (
          <button
            onClick={onStart}
            className="w-full py-6 px-6 rounded-lg bg-[color:var(--foreground)] text-[color:var(--bg)] font-semibold hover:opacity-90 transition flex items-center justify-center gap-3 text-lg"
          >
            <Circle className="w-6 h-6 fill-current" />
            Começar
          </button>
        )}
      </div>

      {/* Info */}
      <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)] p-6 text-sm text-[color:var(--muted-strong)]">
        <p>
          Se fechar a aba por acidente, abra novamente nos próximos 30 minutos
          para continuar a mesma gravação.
        </p>
      </div>
    </div>
  );
}
