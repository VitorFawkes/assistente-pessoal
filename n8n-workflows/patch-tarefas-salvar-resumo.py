#!/usr/bin/env python3
"""Patch: o reprocesso passa a SALVAR o resumo que ele mesmo gera (agosto/2026).

Sintoma: renomear um speaker (ou pedir "refazer") reescrevia as tarefas, mas o
resumo executivo na tela continuava o antigo. Causa: `acoes-reprocess-tarefas`
roda o pipeline inteiro (Stage A Summary -> Judge -> Aggregate -> Distiller) e
grava só as tarefas — não existe nó de UPDATE em `meetings`, então o
`executive_summary` recalculado era descartado. O `acoes-process-segment` tem o
nó equivalente ("12. UPDATE meeting (done)").

Este patch, em acoes-reprocess-tarefas.json:
  - novo nó Postgres "UPDATE meeting (summary)" (executeOnce) gravando
    summary + raw_ai_response, casando por id + user_id. Não toca em
    status/done_at — reprocesso não muda o estado da reunião.
  - religa Aggregate -> UPDATE meeting (summary) -> Has Actions?
  - "Has Actions?" passa a ler no_actions via $('Aggregate') em vez do item da
    entrada, porque agora a entrada dele é a linha devolvida pelo UPDATE.

Idempotente (detecta se já aplicado). Depois: `source .env && ./apply.sh`.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
FILE = "acoes-reprocess-tarefas.json"
NODE_NAME = "UPDATE meeting (summary)"

IF_OLD = "={{ $json.no_actions }}"
IF_NEW = "={{ $('Aggregate').first().json.no_actions }}"


def main():
    path = os.path.join(HERE, FILE)
    wf = json.load(open(path))
    names = {n["name"] for n in wf["nodes"]}

    if NODE_NAME in names:
        print(f"  = {FILE}: já aplicado")
        return

    insert = next(n for n in wf["nodes"] if n["name"] == "INSERT tarefas")
    aggregate = next(n for n in wf["nodes"] if n["name"] == "Aggregate")

    node = {
        "parameters": {
            "operation": "update",
            "schema": {"__rl": True, "mode": "list", "value": "public"},
            "table": {"__rl": True, "mode": "list", "value": "meetings"},
            "columns": {
                "mappingMode": "defineBelow",
                "value": {
                    "id": "={{ $('Webhook').first().json.body.meeting_id }}",
                    "user_id": "={{ $('SELECT meeting').first().json.user_id }}",
                    "summary": "={{ $('Aggregate').first().json.summary }}",
                    "raw_ai_response": "={{ $('Aggregate').first().json.raw_ai_response }}",
                },
                "matchingColumns": ["id", "user_id"],
                "schema": [],
            },
            "options": {},
        },
        "id": "sc-updatesummary",
        "name": NODE_NAME,
        "type": "n8n-nodes-base.postgres",
        "typeVersion": insert.get("typeVersion", 2.5),
        # Aggregate emite 1 item por ação — sem isso o UPDATE rodaria N vezes.
        "executeOnce": True,
        "position": [aggregate["position"][0] + 180, aggregate["position"][1] + 160],
        "credentials": insert.get("credentials", {}),
    }
    wf["nodes"].append(node)

    conns = wf["connections"]
    depois_do_aggregate = conns["Aggregate"]["main"][0]
    conns["Aggregate"]["main"][0] = [
        {"node": NODE_NAME, "type": "main", "index": 0}
    ]
    conns[NODE_NAME] = {"main": [depois_do_aggregate]}

    node_if = next(n for n in wf["nodes"] if n["name"] == "Has Actions?")
    cond = node_if["parameters"]["conditions"]["conditions"][0]
    if cond["leftValue"] != IF_OLD:
        raise SystemExit(f"  !! Has Actions? não está no formato esperado: {cond['leftValue']}")
    cond["leftValue"] = IF_NEW

    with open(path, "w") as fh:
        json.dump(wf, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"  ✓ {FILE}: nó '{NODE_NAME}' criado e religado")


if __name__ == "__main__":
    sys.exit(main())
