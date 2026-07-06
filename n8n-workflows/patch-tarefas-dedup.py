#!/usr/bin/env python3
"""Patch: dedup do self-consistency (julho/2026).

Bug: o Judge agrupava por "mesmo entregável E mesmo dono". Quando as 3 execuções
discordavam do dono (ou variavam a redação), a MESMA tarefa virava grupos separados
→ tarefas duplicadas (ex.: 737db5b4 tinha "Utilizar a área de análise do Claude"
2×, uma owner=vitor outra owner=Tiago).

Fix nos 4 workflows:
  1. Build Judge Prompt: agrupar por MESMO ENTREGÁVEL, ignorando divergência de dono
     (a maioria resolve o dono depois no Aggregate).
  2. Aggregate: rede de segurança determinística — colapsa tarefas de título
     normalizado idêntico (funde pessoas, mantém a descrição mais longa).

Idempotente. Depois: `source .env && ./apply.sh`.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
FILES = ["acoes-audio-ingest.json", "acoes-process-segment.json",
         "acoes-reprocess-meeting.json", "acoes-reprocess-tarefas.json"]

JUDGE_OLD = "(mesmo entregável/objetivo e mesmo dono)."
JUDGE_NEW = ("(o MESMO ENTREGÁVEL/OBJETIVO). IGNORE diferenças de redação E de dono "
             "(execuções discordam de quem faz — o dono é resolvido depois por maioria): "
             "agrupe itens do mesmo entregável AINDA QUE os donos difiram.")

DEDUP_ANCHOR = "if(!out.length){"
DEDUP_BLOCK = (
    "// dedup determinístico: colapsa tarefas de título normalizado idêntico (rede de segurança)\n"
    "function __normT(t){return String(t||'').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();}\n"
    "{const __seen={};const __dd=[];for(const a of out){const k=__normT(a.titulo);if(__seen[k]){const e=__seen[k];"
    "try{const pa=JSON.parse(e.pessoas_raw||'[]'),pb=JSON.parse(a.pessoas_raw||'[]');for(const x of pb){if(!pa.some(y=>String(y).toLowerCase()===String(x).toLowerCase()))pa.push(x);}e.pessoas_raw=JSON.stringify(pa);}catch(_e){}"
    "if(String(a.descricao||'').length>String(e.descricao||'').length)e.descricao=a.descricao;"
    "if(!e.prazo&&a.prazo){e.prazo=a.prazo;e.prazo_text=a.prazo_text;}"
    "e.precisa_revisao=e.precisa_revisao&&a.precisa_revisao;}else{__seen[k]=a;__dd.push(a);}}out.length=0;out.push(...__dd);}\n"
)


def repl_raw(raw, old_str, new_str, what):
    fo = json.dumps(old_str, ensure_ascii=False)
    fn = json.dumps(new_str, ensure_ascii=False)
    if raw.count(fo) != 1:
        raise SystemExit(f"  !! {what}: esperava 1 ocorrência, achei {raw.count(fo)}")
    return raw.replace(fo, fn)


def main():
    for f in FILES:
        path = os.path.join(HERE, f)
        raw = open(path, encoding="utf-8").read()
        d = json.loads(raw)
        bjp = next(n for n in d["nodes"] if n["name"] == "Build Judge Prompt")
        agg = next(n for n in d["nodes"] if n["name"] == "Aggregate")
        old_j = bjp["parameters"]["jsCode"]
        old_a = agg["parameters"]["jsCode"]

        done = []
        if JUDGE_OLD in old_j:
            raw = repl_raw(raw, old_j, old_j.replace(JUDGE_OLD, JUDGE_NEW, 1), "judge"); done.append("judge")
        elif "AINDA QUE os donos difiram" in old_j:
            pass  # já aplicado
        if "__normT" not in old_a:
            if DEDUP_ANCHOR not in old_a:
                raise SystemExit(f"  !! {f}: âncora do dedup não encontrada no Aggregate")
            new_a = old_a.replace(DEDUP_ANCHOR, DEDUP_BLOCK + DEDUP_ANCHOR, 1)
            raw = repl_raw(raw, old_a, new_a, "aggregate"); done.append("agg-dedup")

        if done:
            json.loads(raw)
            open(path, "w", encoding="utf-8").write(raw)
        print(f"{f}: {', '.join(done) if done else 'nada (já aplicado)'}")


if __name__ == "__main__":
    main()
