"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Mic, Video, Circle, Square, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { RecordingGuide } from "./recording-guide";
import { RecordingControls } from "./recording-controls";
import { FileUploader } from "./file-uploader";

type RecordingState = "init" | "recording" | "stopping" | "stopped" | "erro-envio";

export function RecordingScreen({ userId }: { userId: string }) {
  const [mode, setMode] = useState<"na-sala" | "online" | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [recording, setRecording] = useState(false);
  const [sessionId, setSessionId] = useState<string>("");
  const [chunkCount, setChunkCount] = useState(0);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [showUploader, setShowUploader] = useState(false);
  const [recordingState, setRecordingState] = useState<RecordingState>("init");
  const [resumeSession, setResumeSession] = useState<{
    id: string;
    chunks_count: number;
  } | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const displaySourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const sessionIdRef = useRef("");
  const proximoPedacoRef = useRef(0);
  const parteRef = useRef(0);
  const filaEnvioRef = useRef<Promise<void>>(Promise.resolve());

  const isFirefox = typeof window !== "undefined" && /Firefox/.test(navigator.userAgent);
  const isIPhone =
    typeof window !== "undefined" &&
    /iPhone|iPad|iPod/.test(navigator.userAgent);

  useEffect(() => {
    checkActiveSession();
  }, []);

  async function checkActiveSession() {
    try {
      const response = await fetch("/api/gravacao/ativa");
      const data = await response.json();
      if (data.active) {
        setResumeSession(data.active);
      }
    } catch (err) {
      console.error("Error checking active session:", err);
    }
  }

  async function acquireWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await (
          navigator.wakeLock as any
        ).request("screen");
        if (wakeLockRef.current) {
          wakeLockRef.current.addEventListener("release", () => {
            console.log("Wake Lock released");
          });
        }
      }
    } catch (err) {
      console.warn("Wake Lock não disponível:", err);
      toast.warning(
        "Deixe esta tela aberta enquanto grava (seu dispositivo pode desligar)"
      );
    }
  }

  function releaseWakeLock() {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
  }

  async function startRecording(resumeId?: string, modo = mode) {
    sessionIdRef.current = resumeId || crypto.randomUUID();
    try {
      if (modo === "na-sala") {
        await startMicOnly();
      } else {
        await startMicAndSystem();
      }
      setRecording(true);
      const newSessionId = sessionIdRef.current;
      setSessionId(newSessionId);
      if (!resumeId) {
        proximoPedacoRef.current = 0;
        setChunkCount(0);
      }
      setStartTime(new Date());
      setRecordingState("recording");
      await acquireWakeLock();
    } catch (err) {
      const negado = (err as { name?: string })?.name === "NotAllowedError";
      const msg = negado
        ? "Permita o uso do microfone para gravar (toque no cadeado ao lado do endereço)."
        : err instanceof Error
          ? err.message
          : "Não foi possível começar a gravação.";
      toast.error(msg);
    }
  }

  async function startMicOnly() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioContextRef.current = ctx;

    const micSource = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const dest = ctx.createMediaStreamDestination();

    micSource.connect(analyser);
    micSource.connect(dest);
    analyserRef.current = analyser;
    micSourceRef.current = micSource;
    destRef.current = dest;

    setupMediaRecorder(dest.stream);
  }

  async function startMicAndSystem() {
    if (isFirefox) {
      throw new Error("Use Chrome ou Edge para gravar reunião online.");
    }

    if (isIPhone) {
      throw new Error("No iPhone, use a opção 'Reunião na sala'.");
    }

    try {
      const [micStream, displayStream] = await Promise.all([
        navigator.mediaDevices.getUserMedia({ audio: true }),
        navigator.mediaDevices.getDisplayMedia({
          audio: { echoCancellation: false },
          video: true,
          systemAudio: "include",
        } as any),
      ]);

      // O Chrome só deixa compartilhar som junto com imagem; a imagem não é usada.
      displayStream.getVideoTracks().forEach((t) => t.stop());
      if (displayStream.getAudioTracks().length === 0) {
        throw new Error("sem-som-do-sistema");
      }
      streamRef.current = micStream;
      displayStreamRef.current = displayStream;

      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = ctx;

      const micSource = ctx.createMediaStreamSource(micStream);
      const displaySource = ctx.createMediaStreamSource(displayStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      const dest = ctx.createMediaStreamDestination();

      micSource.connect(analyser);
      micSource.connect(dest);
      displaySource.connect(dest);
      analyserRef.current = analyser;
      micSourceRef.current = micSource;
      displaySourceRef.current = displaySource;
      destRef.current = dest;

      setupMediaRecorder(dest.stream);

      displayStream.getAudioTracks()[0].onended = () => {
        toast.info("Som do sistema foi desligado");
      };
    } catch (err) {
      if ((err as any).name === "NotAllowedError") {
        throw new Error("Você não permitiu o compartilhamento. Toque em Começar de novo e escolha 'Tela inteira' com 'Compartilhar áudio do sistema'.");
      } else {
        const wantsContinue = confirm(
          "Não consegui capturar o som da reunião online. Vou gravar só sua voz. Tem certeza?"
        );
        if (!wantsContinue) throw new Error("Gravação não iniciada.");
        await startMicOnly();
      }
    }
  }

  function setupMediaRecorder(stream: MediaStream) {
    const tipo = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
    parteRef.current = Date.now();
    proximoPedacoRef.current = 0;
    mediaRecorderRef.current = rec;

    rec.ondataavailable = (e) => {
      if (e.data.size > 0) {
        const indice = proximoPedacoRef.current++;
        const parte = parteRef.current;
        filaEnvioRef.current = filaEnvioRef.current.then(() => sendChunk(e.data, indice, parte));
      }
    };

    rec.onstop = () => {
      stopAllStreams();
    };

    rec.start(30000);
  }

  async function sendChunk(blob: Blob, indice: number, parte: number) {
    for (let tentativa = 1; tentativa <= 5; tentativa++) {
      try {
        const formData = new FormData();
        formData.append("audio", blob);
        const response = await fetch(`/api/gravacao/${sessionIdRef.current}/pedaco?chunk=${indice}&parte=${parte}`, {
          method: "POST",
          body: formData,
        });
        if (!response.ok) throw new Error(String(response.status));
        setChunkCount((c) => c + 1);
        return;
      } catch (err) {
        console.error("Envio do áudio falhou, tentando de novo:", err);
        await new Promise((r) => setTimeout(r, tentativa * 2000));
      }
    }
    toast.error("A internet caiu e parte do áudio não subiu. Continue gravando; tentamos de novo no fim.");
  }

  function stopAllStreams() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    displayStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioContextRef.current?.close();
    streamRef.current = null;
    displayStreamRef.current = null;
    audioContextRef.current = null;
  }

  async function finalizar() {
    setRecordingState("stopping");
    try {
      await filaEnvioRef.current;
      const response = await fetch(`/api/gravacao/${sessionIdRef.current}/fim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Erro ao finalizar: ${response.status}`);
      }
      setRecordingState("stopped");
    } catch (err) {
      toast.error("Não conseguimos enviar sua gravação. Toque em Tentar de novo.");
      setRecordingState("erro-envio");
    }
  }

  async function stopRecording() {
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    const parou = new Promise<void>((resolve) => rec.addEventListener("stop", () => resolve(), { once: true }));
    rec.stop();
    setRecording(false);
    setRecordingState("stopping");
    releaseWakeLock();
    await parou;
    await finalizar();
  }

  const handleRetryStop = useCallback(() => finalizar(), []);

  if (showUploader) {
    return <FileUploader onClose={() => setShowUploader(false)} userId={userId} />;
  }

  if (recordingState === "stopping") {
    return (
      <div className="space-y-8 max-w-2xl text-center">
        <div className="space-y-4">
          <div className="inline-block animate-spin">
            <Circle className="w-8 h-8 text-[color:var(--foreground)]" />
          </div>
          <div>
            <p className="text-lg font-semibold text-[color:var(--foreground)]">
              Enviando sua gravação…
            </p>
            <p className="text-sm text-[color:var(--muted-strong)] mt-2">
              Não feche esta aba
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (recordingState === "erro-envio") {
    return (
      <div className="space-y-6 max-w-2xl text-center">
        <p className="font-display text-2xl">Sua gravação está guardada, mas não subiu</p>
        <p className="text-[color:var(--muted-strong)]">Confira a internet e toque no botão abaixo. Não feche esta aba.</p>
        <button
          onClick={() => finalizar()}
          className="w-full py-4 rounded-2xl bg-[color:var(--foreground)] text-[color:var(--background)] font-semibold text-lg"
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  if (recordingState === "stopped") {
    return (
      <div className="space-y-8 max-w-2xl">
        <div className="text-center space-y-6">
          <div className="space-y-3">
            <Circle className="w-12 h-12 text-green-600 fill-green-600 mx-auto" />
            <div>
              <p className="text-xl font-semibold text-[color:var(--foreground)]">
                Pronto!
              </p>
              <p className="text-[color:var(--muted-strong)] mt-2">
                Sua reunião aparece em Reuniões em poucos minutos
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              window.location.href = "/reunioes";
            }}
            className="w-full py-4 px-6 rounded-lg bg-[color:var(--foreground)] text-[color:var(--background)] font-semibold hover:opacity-90 transition"
          >
            Ver minhas reuniões
          </button>
        </div>
      </div>
    );
  }

  if (resumeSession && mode === null) {
    return (
      <div className="space-y-6 max-w-2xl">
        <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-6">
          <p className="font-semibold text-[color:var(--foreground)] mb-4">
            Você tem uma gravação em andamento
          </p>
          <p className="text-sm text-[color:var(--muted-strong)] mb-6">
            Iniciada há pouco tempo com {resumeSession.chunks_count} envios
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => {
                setMode("na-sala");
                setResumeSession(null);
                startRecording(resumeSession.id, "na-sala");
              }}
              className="flex-1 py-3 px-4 rounded-lg bg-[color:var(--foreground)] text-[color:var(--background)] font-semibold hover:opacity-90 transition"
            >
              Continuar gravando
            </button>
            <button
              onClick={() => {
                sessionIdRef.current = resumeSession.id;
                setResumeSession(null);
                finalizar();
              }}
              className="flex-1 py-3 px-4 rounded-lg border border-[color:var(--border)] text-[color:var(--foreground)] hover:bg-[color:var(--card)] transition"
            >
              Encerrar e processar
            </button>
          </div>
        </div>

        <button
          onClick={() => {
            setMode("na-sala");
            setShowGuide(false);
          }}
          className="w-full rounded-2xl border-2 border-[color:var(--border)] bg-[color:var(--background)] hover:border-[color:var(--foreground)]/50 p-8 text-left transition group"
        >
          <div className="flex items-start gap-4">
            <Mic className="w-8 h-8 text-[color:var(--foreground)] group-hover:scale-110 transition" />
            <div>
              <p className="font-semibold text-lg">Reunião na sala</p>
              <p className="text-sm text-[color:var(--muted-strong)]">
                Grava a sala pelo microfone
              </p>
            </div>
          </div>
        </button>

        {!isIPhone && (
          <button
            onClick={() => {
              setMode("online");
              setShowGuide(true);
            }}
            className="w-full rounded-2xl border-2 border-[color:var(--border)] bg-[color:var(--background)] hover:border-[color:var(--foreground)]/50 p-8 text-left transition group"
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
        )}

        <button
          onClick={() => setShowUploader(true)}
          className="w-full rounded-2xl border-2 border-[color:var(--border)] bg-[color:var(--background)] hover:border-[color:var(--foreground)]/50 p-8 text-left transition group"
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
      </div>
    );
  }

  if (mode === null) {
    return (
      <div className="space-y-4 max-w-2xl">
        <button
          onClick={() => {
            setMode("na-sala");
            setShowGuide(false);
          }}
          className="w-full rounded-2xl border-2 border-[color:var(--border)] bg-[color:var(--background)] hover:border-[color:var(--foreground)]/50 p-8 text-left transition group"
        >
          <div className="flex items-start gap-4">
            <Mic className="w-8 h-8 text-[color:var(--foreground)] group-hover:scale-110 transition" />
            <div>
              <p className="font-semibold text-lg">Reunião na sala</p>
              <p className="text-sm text-[color:var(--muted-strong)]">
                Grava a sala pelo microfone
              </p>
            </div>
          </div>
        </button>

        {!isIPhone && (
          <button
            onClick={() => {
              setMode("online");
              setShowGuide(true);
            }}
            className="w-full rounded-2xl border-2 border-[color:var(--border)] bg-[color:var(--background)] hover:border-[color:var(--foreground)]/50 p-8 text-left transition group"
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
        )}

        <button
          onClick={() => setShowUploader(true)}
          className="w-full rounded-2xl border-2 border-[color:var(--border)] bg-[color:var(--background)] hover:border-[color:var(--foreground)]/50 p-8 text-left transition group"
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

        {isIPhone && (
          <div className="rounded-lg border border-yellow-600/30 bg-yellow-600/10 p-4 flex gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-yellow-600">
              No iPhone: para reuniões online, use "Reunião na sala" e coloque no alto-falante
            </p>
          </div>
        )}

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
      analyser={analyserRef.current}
      onStart={() => startRecording()}
      onStop={stopRecording}
      onRetry={handleRetryStop}
      onBack={() => {
        setMode(null);
        stopAllStreams();
      }}
    />
  );
}
