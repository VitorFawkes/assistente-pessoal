#!/usr/bin/env python3
"""Agregador self-consistency N=3 (o fix de consistência validado).

Roda a extração N vezes, um juiz LLM agrupa as AÇÕES que são a mesma tarefa
subjacente (ignorando redação), e:
  - grupo em >= maioria (>=2 de 3) -> tarefa FIRME (borderline=false)
  - grupo em < maioria (1 de 3)    -> tarefa BORDERLINE (borderline=true -> precisa_revisao)
Campos (owner/acao/prazo/area/prioridade) = voto de maioria entre os membros.
Título = canônico escolhido pelo juiz.

Isto é o algoritmo de PRODUÇÃO; aqui rodamos offline pra validar estabilidade/qualidade.

Uso: source .env && python3 ops/eval/aggregate.py <meeting_prefix> [N] [workflow.json]
"""
import sys, os, json, collections
sys.path.insert(0, os.path.dirname(__file__))
import consistency as c

MODEL = "gpt-5.1"
FIELDS = ["owner", "acao", "prazo_iso", "prazo_text", "prioridade", "area"]


def extract_full(messages):
    """Uma extração; retorna lista de dicts de ação (com os campos que usamos)."""
    body = {"model": MODEL, "messages": messages, "response_format": {"type": "json_object"}}
    if os.environ.get("TEMP") not in (None, ""):
        body["temperature"] = float(os.environ["TEMP"])
    r = c._curl_openai("chat/completions", body)
    out = json.loads(r["choices"][0]["message"]["content"])
    acts = []
    for a in out.get("actions", []):
        if (a.get("titulo") or "").strip():
            acts.append({k: a.get(k) for k in (["titulo"] + FIELDS + ["pessoas_envolvidas", "borderline"])})
    return acts


def judge_group(runs):
    """Juiz agrupa ações iguais entre runs. Refere itens por (run R, item I)."""
    listing = []
    for ri, acts in enumerate(runs):
        listing.append(f"EXECUÇÃO {ri+1}:")
        for ii, a in enumerate(acts):
            listing.append(f"  [{ri+1}.{ii}] {a['titulo']}  (owner={a.get('owner')}, acao={a.get('acao')})")
    prompt = (
        "Abaixo, tarefas extraídas da MESMA reunião em várias execuções do mesmo modelo. "
        "Diferenças de REDAÇÃO são esperadas — IGNORE. Agrupe os itens que são a MESMA tarefa "
        "subjacente (mesmo entregável/objetivo e mesmo dono). Itens distintos NÃO devem ser juntados "
        "só por tema parecido. Cada item pertence a exatamente um grupo.\n"
        "Para cada grupo dê um 'canonical' (título curto, claro, no infinitivo) e a lista de refs [R.I].\n\n"
        "Retorne JSON: {\"grupos\":[{\"canonical\":\"...\",\"refs\":[\"1.0\",\"2.3\",...]}]}\n\n"
        + "\n".join(listing))
    r = c._curl_openai("chat/completions", {
        "model": MODEL, "messages": [{"role": "user", "content": prompt}],
        "response_format": {"type": "json_object"}})
    return json.loads(r["choices"][0]["message"]["content"]).get("grupos", [])


def _mode(vals):
    vals = [v for v in vals if v not in (None, "", [])]
    if not vals:
        return None
    # normaliza tipos hasheáveis
    norm = [json.dumps(v, ensure_ascii=False) if isinstance(v, (list, dict)) else v for v in vals]
    common = collections.Counter(norm).most_common(1)[0][0]
    try:
        return json.loads(common)
    except Exception:
        return common


def aggregate(runs, N):
    grupos = judge_group(runs)
    final = []
    for g in grupos:
        refs = []
        for ref in g.get("refs", []):
            try:
                ri, ii = (int(x) for x in str(ref).split("."))
                refs.append(runs[ri-1][ii])
            except Exception:
                pass
        if not refs:
            continue
        runset = {int(str(ref).split(".")[0]) for ref in g.get("refs", []) if "." in str(ref)}
        cov = len(runset)
        maj = (N // 2) + 1
        item = {"titulo": g.get("canonical") or refs[0]["titulo"]}
        for f in FIELDS:
            item[f] = _mode([r.get(f) for r in refs])
        # pessoas: união
        ppl = []
        for r in refs:
            for p in (r.get("pessoas_envolvidas") or []):
                if p not in ppl:
                    ppl.append(p)
        item["pessoas_envolvidas"] = ppl
        item["_cov"] = cov
        item["borderline"] = cov < maj
        final.append(item)
    final.sort(key=lambda x: (-x["_cov"], x["titulo"]))
    return final


def main():
    mid = sys.argv[1]
    N = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    wf = sys.argv[3] if len(sys.argv) > 3 else "n8n-workflows/acoes-audio-ingest.json"
    messages, labels = c.build_messages(mid, wf)
    print(f"reunião {mid} | labels={labels} | N={N} | AGREGADO self-consistency")
    runs = [extract_full(messages) for _ in range(N)]
    print(f"  runs: {[len(r) for r in runs]} ações")
    final = aggregate(runs, N)
    firme = [x for x in final if not x["borderline"]]
    bl = [x for x in final if x["borderline"]]
    print(f"\n{'='*84}\nRESULTADO AGREGADO: {len(firme)} firmes + {len(bl)} borderline (flag precisa_revisao)\n{'='*84}")
    for x in final:
        tag = "✅FIRME   " if not x["borderline"] else "⚠️ REVISAR"
        print(f"  {tag} [{x['_cov']}/{N}] [{x['owner']}/{x['acao']}] {x['titulo']}")
    return final


if __name__ == "__main__":
    main()
