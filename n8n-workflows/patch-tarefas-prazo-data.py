#!/usr/bin/env python3
"""Patch: PRAZO resolvido pela DATA DA REUNIÃO (julho/2026).

Bug: o modelo nunca recebia a data da reunião, então resolvia datas relativas/
não-qualificadas contra a noção interna de "hoje" → ano errado (2025) ou dia do
processamento. Além disso datas YYYY-MM-DD viravam meia-noite UTC (exibiam 1 dia antes).

Fix nos 4 workflows:
  1. Distiller (system): nova seção PRAZO — resolver toda data a partir da data da
     reunião (incl. ano); prazo_iso YYYY-MM-DD; null se nada foi dito.
  2. Build Distiller Input (jsCode): calcula data_reuniao (pt-BR) do recorded_at.
  3. Distiller (user): injeta "CONTEXTO TEMPORAL: a reunião foi gravada em {data}".
  4. Aggregate (jsCode): normaliza prazo -> fim do dia local (23:59-03:00) e só grava
     se houver prazo_text real (mata alucinação + off-by-one de fuso).

Idempotente. Novo system lido de .distiller_sys_new.txt (já com a seção PRAZO).
Depois: `source .env && ./apply.sh`.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
NEW_DISTILLER = open(os.path.join(HERE, ".distiller_sys_new.txt")).read()

# recorded_at reachable por workflow (nó que o Build Distiller Input pode ler)
RECORDED_SRC = {
    "acoes-audio-ingest.json":     "$('7e. Build Labeled Text').first().json.recorded_at",
    "acoes-process-segment.json":  "$('3. Prepare Metadata').first().json.recorded_at",
    "acoes-reprocess-meeting.json":"$('Build Labeled Text').first().json.recorded_at",
    "acoes-reprocess-tarefas.json":"$('Build Labeled Text').first().json.recorded_at",
}

ANCHOR = ("CONTEXTO TEMPORAL — a reunião foi gravada em "
          "{{ $('Build Distiller Input').first().json.data_reuniao }}. "
          "Resolva TODA data relativa (hoje, amanhã, dias da semana, \"3 de agosto\") "
          "a partir dessa data, inclusive o ano — nunca a partir de hoje.\n\n")

AGG_OLD = "prazo: mode(refs.map(r=>r.prazo_iso)) || null,"
AGG_NEW = ("prazo: (function(pt){var iso=mode(refs.map(r=>r.prazo_iso));"
           "if(!pt||iso==null)return null;"
           "var mm=String(iso).match(/(\\d{4})-(\\d{2})-(\\d{2})/);"
           "return mm?mm[1]+'-'+mm[2]+'-'+mm[3]+'T23:59:00-03:00':null;})"
           "(cleanPrazo(mode(refs.map(r=>r.prazo_text)))),")

BDI_RET = "return [{ json: {"


def compute_line(src):
    return ("let data_reuniao='';try{const __ra=" + src + ";if(__ra){"
            "data_reuniao=new Date(__ra).toLocaleDateString('pt-BR',"
            "{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric',"
            "timeZone:'America/Sao_Paulo'});}}catch(e){}\n")


def repl_raw(raw, old_str, new_str, what):
    fo = json.dumps(old_str, ensure_ascii=False)
    fn = json.dumps(new_str, ensure_ascii=False)
    if raw.count(fo) != 1:
        raise SystemExit(f"  !! {what}: esperava 1 ocorrência, achei {raw.count(fo)}")
    return raw.replace(fo, fn)


def main():
    for f, src in RECORDED_SRC.items():
        path = os.path.join(HERE, f)
        raw = open(path, encoding="utf-8").read()
        d = json.loads(raw)
        distiller = next(n for n in d["nodes"] if n["name"] == "Distiller")
        bdi = next(n for n in d["nodes"] if n["name"] == "Build Distiller Input")
        agg = next(n for n in d["nodes"] if n["name"] == "Aggregate")

        old_sys = distiller["parameters"]["messages"]["values"][0]["content"]
        um_obj = next(m for m in distiller["parameters"]["messages"]["values"] if m.get("role") != "system")
        old_user = um_obj["content"]
        old_bdi = bdi["parameters"]["jsCode"]
        old_agg = agg["parameters"]["jsCode"]

        done = []
        # 1) system prompt
        if "seção PRAZO" not in old_sys and "PRAZO — resolva SEMPRE" not in old_sys:
            raw = repl_raw(raw, old_sys, NEW_DISTILLER, "distiller-sys"); done.append("sys")
        # 2) Build Distiller Input -> data_reuniao
        if "data_reuniao" not in old_bdi:
            new_bdi = old_bdi.replace(BDI_RET, compute_line(src) + BDI_RET + "\n  data_reuniao,", 1)
            raw = repl_raw(raw, old_bdi, new_bdi, "build-distiller-input"); done.append("bdi")
        # 3) Distiller user -> anchor
        if "CONTEXTO TEMPORAL" not in old_user:
            if not old_user.startswith("="):
                raise SystemExit(f"  !! {f}: user message não começa com '='")
            new_user = "=" + ANCHOR + old_user[1:]
            raw = repl_raw(raw, old_user, new_user, "distiller-user"); done.append("user")
        # 4) Aggregate -> normaliza + gate
        if AGG_OLD in old_agg:
            new_agg = old_agg.replace(AGG_OLD, AGG_NEW, 1)
            raw = repl_raw(raw, old_agg, new_agg, "aggregate"); done.append("agg")

        if done:
            json.loads(raw)  # valida JSON
            open(path, "w", encoding="utf-8").write(raw)
        print(f"{f}: {', '.join(done) if done else 'nada (já aplicado)'}")


if __name__ == "__main__":
    main()
