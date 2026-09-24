"use client";

import { useEffect, useState, useRef } from "react";
import { Circle, Square, ChevronLeft, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export function RecordingControls({
  mode,
  recording,
  chunkCount,
  startTime,
  analyser,
  onStart,
  onStop,
  onRetry,
  onBack,
}: {
  mode: "na-sala" | "online";
  recording: boolean;
  chunkCount: number;
  startTime: Date | null;
  analyser: AnalyserNode | null;
  onStart: () => void;
  onStop: () => void;
  onRetry: () => void;
  onBack: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [levelValue, setLevelValue] = useState(0);
  const [silenceWarning, setSilenceWarning] = useState(false);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const animationRef = useRef<number | null>(null);
  const silenceCounterRef = useRef(0);

  // Timer
  useEffect(() => {
    if (!recording || !startTime) return;
    const interval = setInterval(() => {
      setElapsed(Date.now() - startTime.getTime());
    }, 100);
    return () => clearInterval(interval);
  }, [recording, startTime]);

  // Level meter with analyser
  useEffect(() => {
    if (!recording || !analyser) return;

    if (!dataArrayRef.current) {
      dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
    }

    function updateLevel() {
      if (!analyser || !dataArrayRef.current) return;

      const data = dataArrayRef.current;
      (analyser as any).getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        sum += data[i];
      }
      const average = sum / data.length;
      setLevelValue(Math.round(average));

      // Check for silence (average < 10 out of 255)
      if (average < 10) {
        silenceCounterRef.current++;
        if (silenceCounterRef.current > 100) {
          // ~10 seconds at 10 updates/second
          setSilenceWarning(true);
          silenceCounterRef.current = 0;
        }
      } else {
        silenceCounterRef.current = 0;
        setSilenceWarning(false);
      }

      animationRef.current = requestAnimationFrame(updateLevel);
    }

    animationRef.current = requestAnimationFrame(updateLevel);

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [recording, analyser]);

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

  // Para sozinho em 6 h (gravação esquecida), como o gravador do Mac
  useEffect(() => {
    if (recording && seconds >= 6 * 3600) {
      onStop();
    }
  }, [recording, seconds, onStop]);

  const levelPercent = Math.min(100, Math.round((levelValue / 255) * 100));

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
              <div className="h-3 bg-[color:var(--border)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[color:var(--foreground)] transition-all duration-100"
                  style={{ width: `${levelPercent}%` }}
                />
              </div>
            </div>

            {/* Silence Warning */}
            {silenceWarning && (
              <div className="rounded-lg border border-yellow-600/30 bg-yellow-600/10 p-4 flex gap-3">
                <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-yellow-700">
                    Não estamos ouvindo nada
                  </p>
                  <p className="text-xs text-yellow-600 mt-1">
                    Confira se o microfone certo está escolhido
                  </p>
                </div>
              </div>
            )}

            {/* Chunk indicator */}
            <div className="text-sm text-[color:var(--muted-strong)]">
              {chunkCount === 1 ? "1 parte enviada" : `${chunkCount} partes enviadas`}
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
            className="w-full py-6 px-6 rounded-lg bg-[color:var(--foreground)] text-[color:var(--background)] font-semibold hover:opacity-90 transition flex items-center justify-center gap-3 text-lg"
          >
            <Circle className="w-6 h-6 fill-current" />
            Começar
          </button>
        )}
      </div>

      {/* Info */}
      <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-6 text-sm text-[color:var(--muted-strong)]">
        <p>
          Se fechar a aba por acidente, abra novamente nos próximos 30 minutos
          para continuar a mesma gravação.
        </p>
      </div>
    </div>
  );
}
