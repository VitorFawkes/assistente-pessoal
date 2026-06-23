#!/usr/bin/env python3
"""Harness de CONSISTÊNCIA da extração de tarefas.

Roda a MESMA reunião N vezes pelo prompt atual (gpt-5.1) e mede quão estável é o
conjunto de tarefas — exatamente o problema "às vezes vira tarefa, às vezes não".
Não precisa de rótulos (ground truth): mede só estabilidade entre execuções.

Como funciona:
  1. Puxa a reunião (transcrição/segments/speaker_labels) do banco (read-only).
  2. Monta o prompt rotulado igual ao nó 7e + user message (pessoas conhecidas).
  3. Chama o gpt-5.1 N vezes (via curl, evita problema de CA cert do Python no mac).
  4. Embeda os títulos (text-embedding-3-small) e agrupa por similaridade de cosseno.
  5. Reporta, por tarefa (cluster), em quantas das N runs apareceu = estabilidade.

Uso:
  source .env && python3 ops/eval/consistency.py <meeting_id_prefix> [N] [workflow.json]

Defaults: N=5, workflow=n8n-workflows/acoes-audio-ingest.json
Saídas com chamadas à OpenAI; precisa OPENAI_API_KEY + acesso SSH ao banco no .env.
"""
import json, os, subprocess, sys, tempfile, math

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SIM_THRESHOLD = 0.82      # cosseno p/ considerar "mesma tarefa" entre runs
MODEL = "gpt-5.1"
EMBED_MODEL = "text-embedding-3-small"


def runsql(sql: str) -> str:
    """SELECT read-only via sshpass+docker exec (padrão ops/)."""
    remote = ('cid=$(docker ps --format "{{.Names}}" | grep -m1 "n8n_assistente-pessoal-db"); '
              'docker exec -i "$cid" sh -c '
              "'PGPASSWORD=$POSTGRES_PASSWORD psql -U $POSTGRES_USER -d $POSTGRES_DB -tA -f -'")
    p = subprocess.run(
        ["sshpass", "-p", os.environ["VPS_ROOT_PASSWORD"], "ssh",
         "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=15",
         f'{os.environ["VPS_SSH_USER"]}@{os.environ["VPS_SSH_HOST"]}', remote],
        input=sql, capture_output=True, text=True)
    return p.stdout.strip()


def _curl_openai(path: str, body: dict) -> dict:
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(body, f)
        bodyfile = f.name
    out = subprocess.run(
        ["curl", "-sS", "--max-time", "300", f"https://api.openai.com/v1/{path}",
         "-H", f"Authorization: Bearer {os.environ['OPENAI_API_KEY']}",
         "-H", "Content-Type: application/json", "--data", f"@{bodyfile}"],
        capture_output=True, text=True)
    os.unlink(bodyfile)
    r = json.loads(out.stdout)
    if "error" in r:
        raise SystemExit("OpenAI error: " + json.dumps(r["error"])[:300])
    return r


def build_messages(meeting_id: str, workflow_path: str):
    m = json.loads(runsql(
        "SELECT json_build_object('source',source,'meeting_type',meeting_type,"
        "'recorded_at',to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'),"
        "'user_id',user_id,'speaker_labels',speaker_labels,'segments',segments,"
        f"'transcription',transcription) FROM meetings WHERE id::text LIKE '{meeting_id}%';"))
    pessoas = json.loads(runsql(
        "SELECT COALESCE(json_agg(json_build_object('nome',nome,'aliases',aliases) ORDER BY nome),'[]') "
        f"FROM pessoas WHERE user_id='{m['user_id']}';"))
    labels = m.get("speaker_labels") or {}
    segs = m.get("segments") or []
    turns = []
    for s in segs:
        if turns and turns[-1]["speaker"] == s["speaker"]:
            turns[-1]["text"] += s.get("text", "")
        else:
            turns.append({"speaker": s["speaker"], "text": s.get("text", "")})
    lines = [f"{labels.get(t['speaker'], 'Speaker '+t['speaker'])}: {(t['text'] or '').strip()}" for t in turns]
    labeled = "\n".join(lines) if segs else (m.get("transcription") or "")

    wf = json.load(open(os.path.join(ROOT, workflow_path)))
    gpt = next(n for n in wf["nodes"] if "openai" in n.get("type", "").lower())
    sysmsg = next(x for x in gpt["parameters"]["messages"]["values"] if x.get("role") == "system")["content"]
    sysmsg = sysmsg.replace("{{ $now.toISO() }}", "2026-06-18T12:00:00-03:00")
    pl = "\n".join("- " + p["nome"] + ((" (aliases: " + ", ".join(p["aliases"]) + ")") if p.get("aliases") else "") for p in pessoas)
    user = (f"Pessoas conhecidas no histórico (use estes nomes canônicos quando atribuir owner):\n{pl}\n\n"
            f"Transcrição rotulada (gravado em {m['recorded_at']}, source={m['source']}, tipo={m['meeting_type']}):\n\n{labeled}")
    return [{"role": "system", "content": sysmsg}, {"role": "user", "content": user}], labels


def extract_once(messages):
    body = {"model": MODEL, "messages": messages, "response_format": {"type": "json_object"}}
    if os.environ.get("TEMP") not in (None, ""):
        body["temperature"] = float(os.environ["TEMP"])
    if os.environ.get("SEED") not in (None, ""):
        body["seed"] = int(os.environ["SEED"])
    r = _curl_openai("chat/completions", body)
    out = json.loads(r["choices"][0]["message"]["content"])
    return [(a.get("titulo") or "").strip() for a in out.get("actions", []) if (a.get("titulo") or "").strip()]


def embed(texts):
    if not texts:
        return []
    r = _curl_openai("embeddings", {"model": EMBED_MODEL, "input": texts})
    return [d["embedding"] for d in r["data"]]


def cos(a, b):
    dot = sum(x*y for x, y in zip(a, b))
    na = math.sqrt(sum(x*x for x in a)); nb = math.sqrt(sum(y*y for y in b))
    return dot/(na*nb) if na and nb else 0.0


def embed_cluster(runs):
    """Agrupa por similaridade de cosseno dos embeddings dos títulos (greedy)."""
    flat = [(ri, t) for ri, ts in enumerate(runs) for t in ts]
    vecs = embed([t for _, t in flat])
    clusters = []
    for (ri, t), v in zip(flat, vecs):
        best, bestsim = None, 0
        for c in clusters:
            s = cos(v, c["vec"])
            if s > bestsim:
                bestsim, best = s, c
        if best and bestsim >= SIM_THRESHOLD:
            best["runs"].add(ri); best["titles"].append(t)
        else:
            clusters.append({"rep": t, "vec": v, "runs": {ri}, "titles": [t]})
    return clusters


def judge_cluster(runs):
    """Padrão-ouro: um LLM agrupa títulos que se referem à MESMA tarefa subjacente,
    ignorando redação. Remove o artefato de threshold de embedding."""
    listing = "\n\n".join(
        f"EXECUÇÃO {i+1}:\n" + ("\n".join(f"- {t}" for t in r) if r else "(nenhuma)")
        for i, r in enumerate(runs))
    prompt = (
        "Abaixo estão listas de tarefas extraídas da MESMA reunião em várias execuções do mesmo modelo. "
        "Diferenças de REDAÇÃO entre execuções são esperadas e devem ser IGNORADAS. "
        "Agrupe os itens que se referem à MESMA tarefa subjacente (mesmo entregável/objetivo e mesmo dono). "
        "Itens só vão no mesmo grupo se forem REALMENTE a mesma tarefa — não junte tarefas distintas só por tema parecido. "
        "Cada item de cada execução pertence a exatamente um grupo.\n\n"
        "Retorne JSON: {\"grupos\":[{\"canonical\":\"<rótulo curto>\",\"membros\":[{\"exec\":<n>,\"titulo\":\"<literal>\"}]}]}\n\n"
        + listing)
    r = _curl_openai("chat/completions", {
        "model": MODEL, "messages": [{"role": "user", "content": prompt}],
        "response_format": {"type": "json_object"}})
    grupos = json.loads(r["choices"][0]["message"]["content"]).get("grupos", [])
    clusters = []
    for g in grupos:
        runset = {int(m["exec"]) - 1 for m in g.get("membros", []) if m.get("exec")}
        if runset:
            clusters.append({"rep": g.get("canonical", "?"), "runs": runset,
                             "titles": [m.get("titulo", "") for m in g.get("membros", [])]})
    return clusters


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    mid = sys.argv[1]
    N = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    wf = sys.argv[3] if len(sys.argv) > 3 else "n8n-workflows/acoes-audio-ingest.json"

    messages, labels = build_messages(mid, wf)
    method = os.environ.get("CLUSTER", "judge")
    print(f"reunião {mid} | labels={labels} | N={N} runs | prompt={wf} | cluster={method}")
    runs = []
    # reusar runs salvos se REUSE=1 (analisar mesma data com métodos diferentes)
    cache = os.path.join(os.path.dirname(__file__), "runs", f"{mid}.json")
    if os.environ.get("REUSE") == "1" and os.path.exists(cache):
        runs = json.load(open(cache))
        print(f"  (reusando {len(runs)} runs salvos de {cache})")
    else:
        for i in range(N):
            titles = extract_once(messages)
            runs.append(titles)
            print(f"  run {i+1}: {len(titles)} tarefas")
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        json.dump(runs, open(cache, "w"), ensure_ascii=False, indent=1)

    clusters = judge_cluster(runs) if method == "judge" else embed_cluster(runs)
    clusters.sort(key=lambda c: len(c["runs"]), reverse=True)
    stable = [c for c in clusters if len(c["runs"]) == N]
    flick = [c for c in clusters if len(c["runs"]) < N]
    print(f"\n{'='*80}\nCONSISTÊNCIA: {len(clusters)} tarefas distintas | "
          f"{len(stable)} estáveis ({N}/{N}) | {len(flick)} oscilando (<{N})")
    counts = [len(r) for r in runs]
    print(f"contagem por run: {counts}  (min={min(counts)} max={max(counts)})")
    print(f"{'='*80}")
    for c in clusters:
        mark = "✅" if len(c["runs"]) == N else "⚠️ "
        print(f"  {mark} {len(c['runs'])}/{N}  {c['rep'][:72]}")
    # score simples: fração de aparições estáveis
    if clusters:
        stability = sum(len(c["runs"]) for c in clusters) / (len(clusters) * N)
        print(f"\nestabilidade média = {stability:.2f}  (1.0 = toda tarefa aparece em toda run)")

    # --- viabilidade de AGREGAÇÃO (self-consistency) ---
    import math as _m
    maj = _m.ceil(N/2)
    union = len(clusters)
    n_maj = sum(1 for c in clusters if len(c["runs"]) >= maj)
    n_strong = sum(1 for c in clusters if len(c["runs"]) >= N-1)
    print(f"\nAGREGAÇÃO: união(≥1)={union} | maioria(≥{maj})={n_maj} | forte(≥{N-1})={n_strong}")
    if N >= 4:
        h1 = set(range(N//2)); h2 = set(range(N//2, N))
        def sel(half):
            t = _m.ceil(len(half)/2)
            return {id(c) for c in clusters if len(c["runs"] & half) >= t}
        s1, s2 = sel(h1), sel(h2)
        jac = len(s1 & s2) / len(s1 | s2) if (s1 | s2) else 1.0
        print(f"estabilidade da MAIORIA entre metades (Jaccard) = {jac:.2f}  "
              f"(alto = agregar por maioria dá saída reprodutível)")


if __name__ == "__main__":
    main()
