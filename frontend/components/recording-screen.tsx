"use client";

import { useState, useRef, useEffect } from "react";
import { Mic, Video, Circle, Square, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { RecordingGuide } from "./recording-guide";
import { RecordingControls } from "./recording-controls";
import { FileUploader } from "./file-uploader";

export function RecordingScreen({ userId }: { userId: string }) {
  const [mode, setMode] = useState<"na-sala" | "online" | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [recording, setRecording] = useState(false);
  const [sessionId, setSessionId] = useState<string>("");
  const [chunkCount, setChunkCount] = useState(0);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [showUploader, setShowUploader] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const displaySourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  const isFirefox = typeof window !== "undefined" && /Firefox/.test(navigator.userAgent);

  async function startRecording() {
    try {
      if (mode === "na-sala") {
        await startMicOnly();
      } else {
        await startMicAndSystem();
      }
      setRecording(true);
      setSessionId(crypto.randomUUID());
      setChunkCount(0);
      setStartTime(new Date());
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao iniciar gravação";
      toast.error(msg);
    }
  }

  async function startMicOnly() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioContextRef.current = ctx;

    const micSource = ctx.createMediaStreamSource(stream);
    const dest = ctx.createMediaStreamDestination();
    micSource.connect(dest);
    micSourceRef.current = micSource;
    destRef.current = dest;

    setupMediaRecorder(dest.stream);
  }

  async function startMicAndSystem() {
    if (isFirefox) {
      toast.error("Use Chrome ou Edge para grabar reunião online");
      return;
    }

    try {
      const [micStream, displayStream] = await Promise.all([
        navigator.mediaDevices.getUserMedia({ audio: true }),
        navigator.mediaDevices.getDisplayMedia({
          audio: { echoCancellation: false } as any,
          video: false,
        } as any),
      ]);

      streamRef.current = micStream;
      displayStreamRef.current = displayStream;

      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = ctx;

      const micSource = ctx.createMediaStreamSource(micStream);
      const displaySource = ctx.createMediaStreamSource(displayStream);
      const dest = ctx.createMediaStreamDestination();

      micSource.connect(dest);
      displaySource.connect(dest);
      micSourceRef.current = micSource;
      displaySourceRef.current = displaySource;
      destRef.current = dest;

      setupMediaRecorder(dest.stream);

      displayStream.getAudioTracks()[0].onended = () => {
        toast.info("Som do sistema foi desligado");
      };
    } catch (err) {
      if ((err as any).name === "NotAllowedError") {
        toast.error("Permissão negada. Tente novamente.");
      } else {
        toast.error("Som do sistema não disponível. Continuando só com microfone.");
        await startMicOnly();
      }
    }
  }

  function setupMediaRecorder(stream: MediaStream) {
    const rec = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    mediaRecorderRef.current = rec;

    rec.ondataavailable = (e) => {
      if (e.data.size > 0 && sessionId) {
        sendChunk(e.data);
      }
    };

    rec.onstop = () => {
      stopAllStreams();
    };

    // Start recording with timeslice: send data every 30 seconds
    rec.start(30000);
  }

  async function sendChunk(blob: Blob) {
    try {
      const formData = new FormData();
      formData.append("audio", blob);

      const response = await fetch(`/api/gravacao/${sessionId}/pedaco?chunk=${chunkCount}`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Erro ao enviar chunk: ${response.status}`);
      }

      setChunkCount((c) => c + 1);
    } catch (err) {
      console.error("Chunk send error:", err);
      toast.error("Erro ao enviar chunk de áudio");
    }
  }

  function stopAllStreams() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    displayStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioContextRef.current?.close();
    streamRef.current = null;
    displayStreamRef.current = null;
    audioContextRef.current = null;
  }

  async function stopRecording() {
    if (!mediaRecorderRef.current) return;

    mediaRecorderRef.current.stop();
    setRecording(false);

    // Finalizar no servidor
    try {
      const response = await fetch(`/api/gravacao/${sessionId}/fim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Erro ao finalizar: ${response.status}`);
      }

      toast.success("Gravação finalizada! Você recebe o relatório em alguns minutos.");
      setSessionId("");
      setChunkCount(0);
      setStartTime(null);
    } catch (err) {
      toast.error("Erro ao finalizar gravação");
    }
  }

  if (showUploader) {
    return <FileUploader onClose={() => setShowUploader(false)} userId={userId} />;
  }

  if (mode === null) {
    return (
      <div className="space-y-4 max-w-2xl">
        <button
          onClick={() => {
            setMode("na-sala");
            setShowGuide(false);
          }}
          className="w-full rounded-2xl border-2 border-[color:var(--border)] bg-[color:var(--bg)] hover:border-[color:var(--foreground)]/50 p-8 text-left transition group"
        >
          <div className="flex items-start gap-4">
            <Mic className="w-8 h-8 text-[color:var(--foreground)] group-hover:scale-110 transition" />
            <div>
              <p className="font-semibold text-lg">Reunião na sala</p>
              <p className="text-sm text-[color:var(--muted-strong)]">
                Microfone da máquina
              </p>
            </div>
          </div>
        </button>

        <button
          onClick={() => {
            setMode("online");
            setShowGuide(true);
          }}
          className="w-full rounded-2xl border-2 border-[color:var(--border)] bg-[color:var(--bg)] hover:border-[color:var(--foreground)]/50 p-8 text-left transition group"
        >
          <div className="flex items-start gap-4">
            <Video className="w-8 h-8 text-[color:var(--foreground)] group-hover:scale-110 transition" />
            <div>
              <p className="font-semibold text-lg">Reunião online</p>
              <p className="text-sm text-[color:var(--muted-strong)]">
                Teams, Zoom, Meet…
              </p>
            </div>
          </div>
        </button>

        <button
          onClick={() => setShowUploader(true)}
          className="w-full rounded-2xl border-2 border-[color:var(--border)] bg-[color:var(--bg)] hover:border-[color:var(--foreground)]/50 p-8 text-left transition group"
        >
          <div className="flex items-start gap-4">
            <Square className="w-8 h-8 text-[color:var(--foreground)] group-hover:scale-110 transition" />
            <div>
              <p className="font-semibold text-lg">Subir arquivo</p>
              <p className="text-sm text-[color:var(--muted-strong)]">
                Áudio ou vídeo já gravado
              </p>
            </div>
          </div>
        </button>

        {isFirefox && (
          <div className="rounded-lg border border-yellow-600/30 bg-yellow-600/10 p-4 flex gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-yellow-600">
              Firefox: reunião online funciona melhor no Chrome ou Edge
            </p>
          </div>
        )}
      </div>
    );
  }

  if (showGuide && mode === "online") {
    return <RecordingGuide onConfirm={() => setShowGuide(false)} onBack={() => setMode(null)} />;
  }

  return (
    <RecordingControls
      mode={mode}
      recording={recording}
      chunkCount={chunkCount}
      startTime={startTime}
      onStart={startRecording}
      onStop={stopRecording}
      onBack={() => {
        setMode(null);
        stopAllStreams();
      }}
    />
  );
}
