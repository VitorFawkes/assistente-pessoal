// Diagnóstico: tenta vários hostnames DNS internos pro voice-svc e reporta
// o que respondeu. Quando estabilizar o nome correto, posso simplificar.
import { NextResponse } from "next/server";

const CANDIDATES = [
  process.env.VOICE_SVC_URL,
  "http://voice-svc:8000",
  "http://n8n_voice-svc:8000",
  "http://n8n-voice-svc:8000",
].filter((x): x is string => !!x);

async function probe(url: string) {
  const start = Date.now();
  try {
    const res = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep as string */
    }
    return { url, ok: res.ok, status: res.status, body: parsed, ms: Date.now() - start };
  } catch (e) {
    return {
      url,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      ms: Date.now() - start,
    };
  }
}

export async function GET() {
  const results = await Promise.all(CANDIDATES.map(probe));
  const winner = results.find((r) => r.ok);
  return NextResponse.json({ winner: winner?.url ?? null, results });
}
