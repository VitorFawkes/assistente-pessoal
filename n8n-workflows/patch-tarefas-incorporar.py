#!/usr/bin/env python3
"""Patch: tarefa falada de novo entra no card que já existe (setembro/2026).

Antes, os 4 workflows gravavam as tarefas com INSERT direto: nada comparava com
as tarefas de reuniões anteriores, e o mesmo assunto virava card novo a cada
reunião (a página de planejamento do TARS virou 8 cards entre 25/06 e 06/08).

Agora o INSERT sai e entram 2 nós:
  1. "Montar tarefas" (Code): junta as tarefas agregadas numa entrega só.
  2. "Incorporar tarefas" (HTTP): POST no frontend, rota
     /api/admin/tarefas/incorporar, que compara com as existentes e decide o
     que nasce, o que vira "falada de novo" e o que nasce com o aviso de
     repetida (lib/tarefas-repetidas-db.ts). A rota é idempotente (reenvio não
     duplica), então o nó tenta de novo em caso de falha.
E o WhatsApp pós-reunião passa a listar só o que nasceu, com a linha
"Já existiam N, anotei nos cards". No reprocess-tarefas, o SELECT do feedback
passa a trazer só correções e rejeições (os cliques "é a mesma"/"são
diferentes" alimentam a comparação, não a extração).

Idempotente. Depois: `source .env && ./apply.sh`.
"""
import hashlib, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
URL = "http://n8n_assistente-frontend:3000/api/admin/tarefas/incorporar"
# O segredo (= WEBHOOK_TOKEN do frontend) fica numa credencial do próprio n8n,
# "Ações frontend (x-admin-token)", do tipo Header Auth. O n8n bloqueia $env nas
# expressões, e o repositório é público: aqui vai só a referência à credencial.
CREDENCIAL = {"httpHeaderAuth": {"id": "t3N3pXrGfDMjDsvt", "name": "Ações frontend (x-admin-token)"}}
TOKEN = None  # compat: o cabeçalho x-admin-token não vai mais nos parâmetros

MONTAR_JS = """// Junta as tarefas agregadas numa entrega só. O frontend compara com as que
// já existem antes de gravar: repetida vira "falada de novo" no card antigo.
const aggs = $('Aggregate').all().map(i => i.json).filter(j => !j.no_actions);
const meta = __META__;
const tarefas = aggs.map(j => ({
  titulo: j.titulo, descricao: j.descricao, owner: j.owner, acao: j.acao,
  prazo: j.prazo, prazo_text: j.prazo_text, prioridade: j.prioridade,
  evidencia: j.evidencia, area_raw: j.area_raw, pessoas_raw: j.pessoas_raw,
  precisa_revisao: j.precisa_revisao,
}));
return [{ json: { user_id: meta.user_id, meeting_id: meta.meeting_id, reprocessar: __REPROC__, tarefas } }];
"""

WHATSAPP_OLD_HEAD = """const items = $('Aggregate').all().map(i => i.json).filter(j => !j.no_actions);
"""
WHATSAPP_NEW_HEAD = """// O que NASCEU vem do frontend (que já comparou com as tarefas existentes);
// o que já existia virou "falada de novo" no card antigo e entra numa linha só.
let inc = null;
try { inc = $('__INC__').first().json; } catch (e) { inc = null; }
const items = inc && Array.isArray(inc.criadas)
  ? inc.criadas
  : $('Aggregate').all().map(i => i.json).filter(j => !j.no_actions);
const jaExistiam = inc && Array.isArray(inc.juntadas) ? inc.juntadas.length : 0;
"""
WHATSAPP_OLD_EMPTY = """if (!minhas.length && !delegadas.length) {
  msg += '_(nenhuma ação concreta extraída desta reunião)_\\n';
}
"""
WHATSAPP_NEW_EMPTY = """if (jaExistiam) {
  msg += '♻️ Já existiam ' + jaExistiam + ', anotei nos cards\\n\\n';
}

if (!minhas.length && !delegadas.length && !jaExistiam) {
  msg += '_(nenhuma ação concreta extraída desta reunião)_\\n';
}
"""

# (arquivo, nó INSERT, nó de origem, nó destino, meta, reprocessar, token, whatsapp)
WORKFLOWS = [
    ("acoes-audio-ingest.json", "11. INSERT tarefas", "10. Has Actions?", "12. UPDATE meeting (done)",
     "$('3. Prepare Metadata').first().json", "false",
     TOKEN, "13. Build WhatsApp Message"),
    ("acoes-process-segment.json", "11. INSERT tarefas", "10. Has Actions?", "12. UPDATE meeting (done)",
     "$('3. Prepare Metadata').first().json", "false",
     TOKEN, None),
    ("acoes-reprocess-meeting.json", "9. INSERT tarefas", "8. Has Actions?", "10. UPDATE meeting (done)",
     "$('3. Prepare Metadata').first().json", "true",
     TOKEN, "11. Build WhatsApp Message"),
    # reprocess-tarefas: o DELETE das antigas continua antes; "Reemit Actions" some.
    ("acoes-reprocess-tarefas.json", "INSERT tarefas", "DELETE tarefas antigas", "Response",
     "{ user_id: $('SELECT meeting').first().json.user_id, meeting_id: $('Webhook').first().json.body.meeting_id }",
     "true", TOKEN, None),
]


FEEDBACK_OLD = "SELECT tipo, payload FROM extracao_feedback WHERE user_id = '{{ $('SELECT meeting').first().json.user_id }}'::uuid ORDER BY created_at DESC LIMIT 40"
FEEDBACK_NEW = "SELECT tipo, payload FROM extracao_feedback WHERE user_id = '{{ $('SELECT meeting').first().json.user_id }}'::uuid AND tipo IN ('correcao','rejeicao') ORDER BY created_at DESC LIMIT 40"


def feedback_so_extracao():
    path = os.path.join(HERE, "acoes-reprocess-tarefas.json")
    raw = open(path, encoding="utf-8").read()
    d = json.loads(raw)
    n = next(n for n in d["nodes"] if n["name"] == "SELECT feedback")
    if n["parameters"]["query"] == FEEDBACK_OLD:
        n["parameters"]["query"] = FEEDBACK_NEW
        open(path, "w", encoding="utf-8").write(json.dumps(d, indent=2, ensure_ascii=False) + ("\n" if raw.endswith("\n") else ""))
        print("✓ acoes-reprocess-tarefas.json: SELECT feedback só correções/rejeições")


def credencial_no_no(no):
    p = no["parameters"]
    p["authentication"] = "genericCredentialType"
    p["genericAuthType"] = "httpHeaderAuth"
    p["headerParameters"]["parameters"] = [h for h in p["headerParameters"]["parameters"] if h["name"] != "x-admin-token"]
    no["credentials"] = CREDENCIAL


def main():
    feedback_so_extracao()
    for f, insert, origem, destino, meta, reproc, token, wa in WORKFLOWS:
        path = os.path.join(HERE, f)
        raw = open(path, encoding="utf-8").read()
        d = json.loads(raw)
        prefixo = insert.split(" INSERT")[0] if " INSERT" in insert else ""
        montar = f"{prefixo} Montar tarefas".strip() if prefixo else "Montar tarefas"
        incorporar = f"{prefixo.rstrip('.')}b. Incorporar tarefas" if prefixo else "Incorporar tarefas"
        existentes = {n["name"] for n in d["nodes"]}
        if incorporar in existentes:
            # já aplicado: garante que o segredo vem da credencial do n8n
            no = next(n for n in d["nodes"] if n["name"] == incorporar)
            antes = json.dumps(no, sort_keys=True)
            credencial_no_no(no)
            mudou = json.dumps(no, sort_keys=True) != antes
            if mudou:
                out = json.dumps(d, indent=2, ensure_ascii=False) + ("\n" if raw.endswith("\n") else "")
                open(path, "w", encoding="utf-8").write(out)
            print(f"= {f}: já aplicado" + (" (segredo agora vem da credencial)" if mudou else ""))
            continue

        ins = next(n for n in d["nodes"] if n["name"] == insert)
        x, y = ins["position"]
        d["nodes"] = [n for n in d["nodes"] if n["name"] not in (insert, "Reemit Actions")]
        d["nodes"].append({
            "parameters": {"jsCode": MONTAR_JS.replace("__META__", meta).replace("__REPROC__", reproc)},
            "id": "70000000-0000-0000-0000-" + hashlib.md5((f + "montar").encode()).hexdigest()[:12],
            "name": montar,
            "type": "n8n-nodes-base.code",
            "typeVersion": 2,
            "position": [x, y],
        })
        d["nodes"].append({
            "parameters": {
                "method": "POST",
                "url": URL,
                "authentication": "none",
                "sendHeaders": True,
                "headerParameters": {"parameters": [
                    {"name": "Content-Type", "value": "application/json"},
                ]},
                "sendBody": True,
                "specifyBody": "json",
                "jsonBody": "={{ JSON.stringify($json) }}",
                "options": {"timeout": 300000},
            },
            "id": "70000000-0000-0000-0000-" + hashlib.md5((f + "incorporar").encode()).hexdigest()[:12],
            "name": incorporar,
            "type": "n8n-nodes-base.httpRequest",
            "typeVersion": 4.2,
            "position": [x + 200, y],
            "retryOnFail": True,
            "maxTries": 3,
            "waitBetweenTries": 5000,
        })
        credencial_no_no(d["nodes"][-1])

        con = d["connections"]
        # tira as ligações do INSERT e do Reemit
        con.pop(insert, None)
        con.pop("Reemit Actions", None)
        for src, c in con.items():
            for outs in c.get("main", []):
                if outs:
                    outs[:] = [o for o in outs if o["node"] not in (insert, "Reemit Actions")]
        # origem → Montar → Incorporar → destino
        saidas = con[origem]["main"]
        idx = 1 if "Has Actions" in origem else 0
        while len(saidas) <= idx:
            saidas.append([])
        saidas[idx].append({"node": montar, "type": "main", "index": 0})
        con[montar] = {"main": [[{"node": incorporar, "type": "main", "index": 0}]]}
        con[incorporar] = {"main": [[{"node": destino, "type": "main", "index": 0}]]}

        if wa:
            wn = next(n for n in d["nodes"] if n["name"] == wa)
            js = wn["parameters"]["jsCode"]
            if WHATSAPP_OLD_HEAD not in js or WHATSAPP_OLD_EMPTY not in js:
                raise SystemExit(f"  !! {f}: WhatsApp não bate com o esperado")
            js = js.replace(WHATSAPP_OLD_HEAD, WHATSAPP_NEW_HEAD.replace("__INC__", incorporar), 1)
            js = js.replace(WHATSAPP_OLD_EMPTY, WHATSAPP_NEW_EMPTY, 1)
            wn["parameters"]["jsCode"] = js

        out = json.dumps(d, indent=2, ensure_ascii=False) + ("\n" if raw.endswith("\n") else "")
        open(path, "w", encoding="utf-8").write(out)
        print(f"✓ {f}: {insert} → {montar} + {incorporar}" + (f" · {wa}" if wa else ""))


if __name__ == "__main__":
    main()
