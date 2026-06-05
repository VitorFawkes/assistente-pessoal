#!/usr/bin/env python3
"""Aplica os patches da Fase 1 (pessoas_envolvidas + area) num JSON de workflow n8n.
Uso: python3 patch-tarefas-multidim.py <arquivo.json> <gpt_node_name> <parse_node_name> <insert_node_name> [--trailing-nl]
Idempotente: pula se já aplicado."""
import json, sys

PROMPT_SECTIONS = """══════════════════════════════════════════════════════════
PESSOAS ENVOLVIDAS (campo: pessoas_envolvidas)
══════════════════════════════════════════════════════════

Para cada ação, liste em "pessoas_envolvidas" as pessoas que a tarefa CONCERNE —
inclusive quem NÃO falou no áudio (ex: "Marcelo", "Estela", "Patrícia").
- Quando acao=cobrar/aguardar, inclua o owner (a pessoa que vai entregar).
- Inclua a pessoa com quem Vitor vai falar/cobrar/alinhar ("Conversar com Marcelo" → ["Marcelo"]).
- Use o nome canônico das "Pessoas conhecidas" quando casar; senão o nome literal dito.
- NÃO inclua "Vitor". Tarefa solo do Vitor → [].
- Em dúvida sobre o nome, prefira incluir o nome dito a omitir.

══════════════════════════════════════════════════════════
FRENTE / ÁREA (campo: area)
══════════════════════════════════════════════════════════

Classifique cada ação numa frente curta em "area": ex "Marketing", "Vendas/SDR",
"Dados & Dashboards", "Produto", "Trips", "Weddings", "Edis", "Operações". Use o
termo mais natural — o sistema casa com a lista do Vitor depois. Sem frente clara → null.

"""

EXHAUST = ("\n- EXAUSTIVIDADE: não junte pendências numa só ação. Cada compromisso "
           "concreto vira uma ação separada; pedidos compostos (faz X e me manda Y) viram 2+ ações.")

# âncora do shape de output (6 espaços de indentação, confirmado no node 8 do audio-ingest)
OLD_SHELL = '      "evidencia": "<trecho literal até 200 chars>",\n'
# adiciona pessoas_envolvidas + area logo após evidencia no shape de output
NEW_SHELL = (OLD_SHELL +
  '      "pessoas_envolvidas": ["<nome>", ...],\n'
  '      "area": "<frente curta ou null>",\n')

def patch_prompt(sysmsg):
    if "pessoas_envolvidas" in sysmsg:
        return sysmsg  # já aplicado
    # 1) injeta seções antes de "FORMATO DO OUTPUT"
    hi = sysmsg.index("FORMATO DO OUTPUT")
    header_line = sysmsg.rfind("\n", 0, hi) + 1
    div_line = sysmsg.rfind("\n", 0, header_line - 1) + 1
    sysmsg = sysmsg[:div_line] + PROMPT_SECTIONS + sysmsg[div_line:]
    # 2) injeta os campos no shape JSON
    assert sysmsg.count(OLD_SHELL) == 1, f"shape anchor count={sysmsg.count(OLD_SHELL)}"
    sysmsg = sysmsg.replace(OLD_SHELL, NEW_SHELL)
    # 3) reforço de exaustividade no bloco ATENÇÃO FINAL
    anchor = "- Prazos vieram do áudio ou eu inventei?"
    if anchor in sysmsg:
        sysmsg = sysmsg.replace(anchor, anchor + EXHAUST)
    return sysmsg

def patch_parse(js):
    if "pessoas_raw" in js:
        return js
    anchor = "acao: ['executar','cobrar','aguardar'].includes(a.acao)"
    line_start = js.rfind("\n", 0, js.index(anchor)) + 1
    inject = ("    pessoas_raw: JSON.stringify(Array.isArray(a.pessoas_envolvidas) ? a.pessoas_envolvidas : []),\n"
              "    area_raw: a.area || null,\n")
    return js[:line_start] + inject + js[line_start:]

def main():
    path, gpt, parse, insert = sys.argv[1:5]
    trailing = "--trailing-nl" in sys.argv
    d = json.load(open(path, encoding="utf-8"))
    nodes = {n["name"]: n for n in d["nodes"]}
    # prompt
    mv = nodes[gpt]["parameters"]["messages"]["values"][0]
    mv["content"] = patch_prompt(mv["content"])
    # parse actions
    pn = nodes[parse]["parameters"]
    pn["jsCode"] = patch_parse(pn["jsCode"])
    # insert mapping
    cols = nodes[insert]["parameters"]["columns"]["value"]
    cols.setdefault("pessoas_raw", "={{ $json.pessoas_raw }}")
    cols.setdefault("area_raw", "={{ $json.area_raw }}")
    out = json.dumps(d, ensure_ascii=False, indent=2) + ("\n" if trailing else "")
    open(path, "w", encoding="utf-8").write(out)
    print(f"patched {path}: pessoas_envolvidas in prompt={'pessoas_envolvidas' in mv['content']}, "
          f"pessoas_raw in parse={'pessoas_raw' in pn['jsCode']}, insert cols={list(cols)[-2:]}")

if __name__ == "__main__":
    main()
