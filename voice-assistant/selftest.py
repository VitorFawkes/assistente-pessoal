#!/usr/bin/env python3
"""
Self-test SEM microfone:
  1. STT: gera fala com `say` -> wav -> faster-whisper -> confere o texto.
  2. SDK: faz um query mínimo e confirma que autentica (herda login do Claude Code)
     e responde, sem ANTHROPIC_API_KEY.

Uso: voice-assistant/.venv/bin/python voice-assistant/selftest.py
"""
import os
import sys
import tempfile
import subprocess

PHRASE = "o céu está azul e hoje é uma segunda-feira de testes"
EXPECT = ("céu", "azul", "segunda")


def ok(b):
    return "PASS" if b else "FAIL"


def test_stt() -> bool:
    print("\n[1] STT roundtrip (say -> whisper)…")
    aiff = tempfile.mktemp(suffix=".aiff")
    wav = tempfile.mktemp(suffix=".wav")
    subprocess.run(["say", "-v", "Luciana", "-o", aiff, PHRASE], check=True)
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", aiff,
         "-ar", "16000", "-ac", "1", wav], check=True)
    from faster_whisper import WhisperModel
    stt = WhisperModel("small", device="cpu", compute_type="int8")
    segs, _ = stt.transcribe(wav, language="pt", vad_filter=True)
    text = " ".join(s.text for s in segs).strip().lower()
    for f in (aiff, wav):
        if os.path.exists(f):
            os.remove(f)
    print("    falado :", PHRASE)
    print("    ouvido :", text)
    hits = [w for w in EXPECT if w in text]
    passed = len(hits) >= 2
    print(f"    matches: {hits} -> {ok(passed)}")
    return passed


def test_sdk() -> bool:
    print("\n[2] SDK auth + resposta (sem API key)…")
    import anyio
    from claude_agent_sdk import (
        query, ClaudeAgentOptions, AssistantMessage, TextBlock,
    )
    had_key = bool(os.environ.get("ANTHROPIC_API_KEY"))
    print(f"    ANTHROPIC_API_KEY no ambiente: {had_key} (esperado: False)")

    async def run() -> str:
        reply = ""
        opts = ClaudeAgentOptions(
            model="claude-sonnet-4-6",
            permission_mode="dontAsk",
            allowed_tools=[],
        )
        async for m in query(prompt="Responda apenas com a palavra: pronto", options=opts):
            if isinstance(m, AssistantMessage):
                for b in m.content:
                    if isinstance(b, TextBlock):
                        reply += b.text
        return reply.strip()

    try:
        reply = anyio.run(run)
    except Exception as e:
        print(f"    ERRO no SDK: {type(e).__name__}: {e}")
        return False
    print("    resposta:", repr(reply))
    passed = bool(reply)
    print(f"    -> {ok(passed)}")
    return passed


if __name__ == "__main__":
    r1 = test_stt()
    r2 = test_sdk()
    print("\n=== RESUMO ===")
    print(f"  STT : {ok(r1)}")
    print(f"  SDK : {ok(r2)}")
    sys.exit(0 if (r1 and r2) else 1)
