#!/usr/bin/env python3
"""
Assistente de voz hands-free do Vitor.

Dois modos (VA_MODE):
  - "chat"  (default): conversa falada, rápida, só leitura. Fala frase a frase.
  - "coder": você fala a tarefa; ele ESCREVE o código (cria/edita arquivos, roda
             comandos), com freio de segurança, e no fim fala um resumo BREVE.

Loop: grava o mic até parar de falar (sox/VAD) -> Whisper local (pt) -> Claude
(Agent SDK, herda o login do Claude Code) -> fala com `say`. Diga "tchau" pra sair.
Configurável por env (ver README).
"""
import os
import re
import sys
import time
import shutil
import tempfile
import subprocess

import anyio
from faster_whisper import WhisperModel
from claude_agent_sdk import (
    ClaudeSDKClient,
    ClaudeAgentOptions,
    AssistantMessage,
    TextBlock,
    StreamEvent,
    PermissionResultAllow,
    PermissionResultDeny,
)

# ---------------------------------------------------------------- config
MODE = os.environ.get("VA_MODE", "chat").lower()       # "chat" | "coder"
_DEFAULT_MODEL = "claude-sonnet-4-6" if MODE == "coder" else "claude-haiku-4-5"

TTS_ENGINE = os.environ.get("VA_TTS", "edge").lower()  # "edge" (grátis, natural) | "say"
EDGE_VOICE = os.environ.get("VA_EDGE_VOICE", "pt-BR-FranciscaNeural")
EDGE_RATE = os.environ.get("VA_EDGE_RATE", "+8%")      # velocidade da fala do edge-tts
VOICE = os.environ.get("VA_VOICE", "Luciana")          # voz do `say` (fallback)
RATE = os.environ.get("VA_RATE", "190")
MODEL = os.environ.get("VA_MODEL", _DEFAULT_MODEL)     # você escolhe: VA_MODEL=...
WHISPER_MODEL = os.environ.get("VA_WHISPER_MODEL", "medium")  # +preciso; "small"=+rápido
WHISPER_LANG = os.environ.get("VA_WHISPER_LANG", "pt")
SILENCE_PCT = os.environ.get("VA_SILENCE_PCT", "1.5%")
SILENCE_STOP = os.environ.get("VA_SILENCE_STOP", "0.9")
# Normaliza o pico da gravação (adapta-se a mic alto OU baixo, sem clipar). Era um
# `gain +12` cego que clipava e distorcia justamente nomes próprios. "0" desliga.
NORM_DB = os.environ.get("VA_NORM", "-1")
GAIN_DB = os.environ.get("VA_GAIN", "0")              # pré-ganho fixo extra; "0" desliga
# Vocabulário do Vitor: vira initial_prompt do Whisper (puxa grafia de nomes próprios e
# termos de domínio). Editável por VA_WHISPER_PROMPT.
WHISPER_PROMPT = os.environ.get(
    "VA_WHISPER_PROMPT",
    "Conversa do Vitor sobre trabalho. Termos: Welcome Weddings, Welcome Trips, "
    "Estela, Marcelo, n8n, Supabase, Claude, meeting, executive summary, tarefa, "
    "prioridade, área, frente, casal, reprocessar, deploy.",
)
REC_TIMEOUT = int(os.environ.get("VA_REC_TIMEOUT", "120"))
PROFILE = os.environ.get("VA_PROFILE", "0") == "1"
CWD = os.environ.get("VA_CWD", os.getcwd())            # pasta onde ele trabalha
BEEP = os.environ.get("VA_BEEP", "/System/Library/Sounds/Tink.aiff")

END_WORDS = ("tchau", "encerrar", "parar conversa", "pode parar", "fechar conversa")

CHAT_PROMPT = (
    "Você é o assistente de voz pessoal do Vitor. Esta é uma CONVERSA FALADA: "
    "responda em português do Brasil, curto, direto e coloquial — como se estivesse "
    "falando, não escrevendo. Nada de markdown, blocos de código, bullets ou listas "
    "longas. Frases faladas. Vá direto ao ponto; o usuário está te ouvindo, não lendo."
)
CODER_PROMPT = (
    "Você é um engenheiro de software. O Vitor te dá tarefas POR VOZ. "
    f"A PASTA DE TRABALHO é: {CWD}. SEMPRE crie e edite arquivos DENTRO dela (caminhos "
    "relativos a essa pasta); NUNCA escreva fora dela (ex.: no home ~). "
    "Faça a tarefa COMPLETAMENTE: crie/edite os arquivos e rode comandos/testes pra "
    "validar o que fez. NÃO narre cada passo nem leia código em voz alta. "
    "Quando TERMINAR, escreva um resumo BREVE (1 a 3 frases), em português do Brasil "
    "falado, dizendo o que fez e o resultado. Se faltar uma informação ou decisão pra "
    "continuar, pergunte em UMA frase curta."
)

# tools auto-aprovadas (read-only + web). No coder, Write/Edit/Bash passam pelo freio.
SAFE_TOOLS = ["Read", "Grep", "Glob", "WebSearch", "WebFetch"]
# comandos de shell barrados no modo coder (voz mal-entendida não faz estrago)
DESTRUCTIVE = ("rm -rf", "rm -fr", "sudo ", "dd if=", "mkfs", ":(){", "> /dev/",
               "git push --force", "git push -f", "reset --hard", "shutdown", "reboot")

_MD = re.compile(r"[#*_`>~]|```.*?```", re.DOTALL)
_SENT = re.compile(r"(?<=[.!?…])\s+")


def log(msg: str) -> None:
    print(msg, flush=True)


def beep() -> None:
    if BEEP and os.path.exists(BEEP):
        subprocess.run(["afplay", BEEP], capture_output=True)


def speak(text: str) -> None:
    """Fala BLOQUEANTE (espera terminar) — evita o mic capturar a própria voz.

    Padrão: edge-tts (voz pt-BR Francisca, grátis e natural). Se falhar (sem
    internet, etc.), cai no `say` nativo do macOS automaticamente.
    """
    text = _MD.sub(" ", text).strip()
    if not text:
        return
    if TTS_ENGINE == "edge":
        try:
            out = os.path.join(tempfile.gettempdir(), f"va_tts_{os.getpid()}.mp3")
            subprocess.run(
                [sys.executable, "-m", "edge_tts", "--voice", EDGE_VOICE,
                 "--rate", EDGE_RATE, "--text", text, "--write-media", out],
                check=True, capture_output=True, timeout=30,
            )
            subprocess.run(["afplay", out], capture_output=True)
            return
        except Exception as e:
            log(f"[tts] edge-tts falhou ({e}); usando say como fallback")
    subprocess.run(["say", "-v", VOICE, "-r", str(RATE), text])


async def guard(tool_name, tool_input, context):
    """Freio do modo coder: bloqueia só comandos destrutivos; libera o resto."""
    if tool_name == "Bash":
        cmd = tool_input.get("command", "")
        if any(b in cmd for b in DESTRUCTIVE):
            log(f"  [bloqueado] comando destrutivo: {cmd}")
            return PermissionResultDeny(message="Comando destrutivo bloqueado por segurança.")
    return PermissionResultAllow()


_rec_err_shown = False


def record() -> str | None:
    """Grava do mic até ~SILENCE_STOP s de silêncio. Retorna caminho do wav ou None."""
    global _rec_err_shown
    wav = tempfile.mktemp(suffix=".wav", prefix="va_")
    beep()
    cmd = ["rec", "-q", "-c", "1", "-r", "16000", "-b", "16", wav]
    if GAIN_DB and GAIN_DB != "0":
        cmd += ["gain", GAIN_DB]
    cmd += ["silence", "1", "0.1", SILENCE_PCT, "1", SILENCE_STOP, SILENCE_PCT]
    err = ""
    try:
        p = subprocess.run(cmd, timeout=REC_TIMEOUT, capture_output=True, text=True)
        err = p.stderr or ""
    except subprocess.TimeoutExpired:
        pass
    if os.path.exists(wav) and os.path.getsize(wav) > 4000:
        if NORM_DB and NORM_DB != "0":
            # passo de pico (arquivo completo): traz mic baixo ao nível certo sem clipar
            normd = tempfile.mktemp(suffix=".wav", prefix="va_")
            r = subprocess.run(["sox", wav, normd, "gain", "-n", NORM_DB],
                               capture_output=True)
            if r.returncode == 0 and os.path.exists(normd):
                os.replace(normd, wav)
            elif os.path.exists(normd):
                os.remove(normd)
        return wav
    if os.path.exists(wav):
        os.remove(wav)
    real_err = [ln for ln in err.strip().splitlines()
                if ln.strip() and "can't set sample rate" not in ln]
    if real_err and not _rec_err_shown:
        log(f"[aviso] rec: {real_err[-1]}")
        log("        Permissão de microfone? System Settings > Privacy & Security > "
            "Microphone; libere o terminal e reinicie o app.")
        _rec_err_shown = True
    return None


def transcribe(stt: WhisperModel, wav: str) -> str:
    segments, _ = stt.transcribe(
        wav, language=WHISPER_LANG, vad_filter=True, condition_on_previous_text=False,
        initial_prompt=WHISPER_PROMPT or None, temperature=0, beam_size=5,
    )
    parts = []
    for s in segments:
        if getattr(s, "no_speech_prob", 0.0) > 0.6 and len(s.text.strip()) < 12:
            continue
        parts.append(s.text)
    return " ".join(parts).strip()


async def respond_chat(client: ClaudeSDKClient, text: str) -> str:
    """Modo chat: fala frase-a-frase conforme gera (streaming)."""
    await client.query(text)
    reply, buffer, streamed = "", "", False
    t0, first = time.monotonic(), None
    async for msg in client.receive_response():
        if isinstance(msg, StreamEvent):
            ev = msg.event
            if ev.get("type") == "content_block_delta":
                d = ev.get("delta", {})
                if d.get("type") == "text_delta":
                    streamed = True
                    chunk = d.get("text", "") or ""
                    if first is None and chunk.strip():
                        first = time.monotonic() - t0
                    reply += chunk
                    buffer += chunk
                    sents = _SENT.split(buffer)
                    if len(sents) > 1:
                        for s in sents[:-1]:
                            speak(s)
                        buffer = sents[-1]
        elif isinstance(msg, AssistantMessage):
            if not streamed:
                for b in msg.content:
                    if isinstance(b, TextBlock):
                        reply += b.text
                        buffer += b.text
    if buffer.strip():
        speak(buffer)
    if PROFILE and first is not None:
        log(f"   [profile] 1a palavra em {first:.1f}s")
    return reply.strip()


async def respond_coder(client: ClaudeSDKClient, text: str) -> str:
    """Modo coder: faz a tarefa em silêncio; fala SÓ o resumo final."""
    await client.query(text)
    final = ""
    async for msg in client.receive_response():
        if isinstance(msg, AssistantMessage):
            t = "".join(b.text for b in msg.content if isinstance(b, TextBlock)).strip()
            if t:
                final = t
                log(f"  … {t}")
    final = final or "Terminei."
    speak(final)
    return final


async def main() -> None:
    if not shutil.which("rec"):
        log("ERRO: `sox`/`rec` não encontrado. Rode: brew install sox")
        sys.exit(1)

    log(f"Modo: {MODE} | modelo: {MODEL} | pasta: {CWD}")
    log(f"Carregando Whisper ({WHISPER_MODEL})...")
    stt = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
    warm = tempfile.mktemp(suffix=".wav", prefix="warm_")
    subprocess.run(["sox", "-n", "-r", "16000", "-b", "16", warm, "trim", "0", "0.3"],
                   capture_output=True)
    if os.path.exists(warm):
        list(stt.transcribe(warm, language=WHISPER_LANG, vad_filter=True)[0])
        os.remove(warm)
    log("Whisper pronto.")

    if MODE == "coder":
        options = ClaudeAgentOptions(
            system_prompt=CODER_PROMPT, model=MODEL, cwd=CWD,
            allowed_tools=SAFE_TOOLS,        # leitura/web auto; escrita passa pelo freio
            can_use_tool=guard,              # libera tudo menos comando destrutivo
            permission_mode="default",       # -> chama o freio (não trava)
        )
        respond = respond_coder
        ready_line = "— Modo PROGRAMADOR pronto. Fale a tarefa após o beep. 'tchau' pra sair. —"
    else:
        options = ClaudeAgentOptions(
            system_prompt=CHAT_PROMPT, model=MODEL, cwd=CWD,
            allowed_tools=SAFE_TOOLS, permission_mode="dontAsk",
            include_partial_messages=True,   # streaming p/ falar frase-a-frase
            max_thinking_tokens=0,           # sem thinking -> 1a palavra ~3x mais rápida
        )
        respond = respond_chat
        ready_line = "— Assistente de voz pronto. Fale após o beep. 'tchau' pra sair. —"

    async with ClaudeSDKClient(options=options) as client:
        log(ready_line)
        speak("Pode falar.")
        while True:
            wav = record()
            if not wav:
                continue
            t0 = time.monotonic()
            text = transcribe(stt, wav)
            os.remove(wav)
            if not text:
                continue
            log(f"Você: {text}" + (f"   ({time.monotonic()-t0:.1f}s stt)" if PROFILE else ""))

            if any(w in text.lower() for w in END_WORDS):
                speak("Até mais, Vitor.")
                break

            try:
                reply = await respond(client, text)
            except Exception as e:
                log(f"[erro] {type(e).__name__}: {e}")
                speak("Deu um problema aqui, pode repetir?")
                continue
            if MODE != "coder":
                log(f"Claude: {reply}")


if __name__ == "__main__":
    try:
        anyio.run(main)
    except KeyboardInterrupt:
        print("\nEncerrado.")
