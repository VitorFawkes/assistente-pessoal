#!/usr/bin/env python3
"""Patch de QUALIDADE das tarefas (junho/2026).

Corrige a geração de tarefas: menos fragmentação, owner/acao/título coerentes,
atribuição de "quem" mais inteligente e prazo limpo. Mexe em 2 nós por workflow:
  - nó GPT (system message): injeta "REGRAS NOVAS — PRIORIDADE MÁXIMA" + ajustes
  - nó Parse Actions (jsCode): enforcement determinístico (cinto e suspensório)

Uso:
  python3 patch-tarefas-quality.py <arquivo.json> <gpt_node_name> <parse_node_name>

Idempotente: pula a parte já aplicada (detecta marcadores).
Depois de rodar nos 4 workflows: `source .env && ./apply.sh`.
"""
import json, sys

# ─────────────────────────────────────────────────────────────────────
# PROMPT — bloco novo injetado logo após o parágrafo de abertura
# ─────────────────────────────────────────────────────────────────────
OPEN_PARA = "Você precisa entender esse escopo amplo."
PROMPT_MARKER = "REGRAS NOVAS — PRIORIDADE MÁXIMA"

NEW_BLOCK = """

══════════════════════════════════════════════════════════
REGRAS NOVAS — PRIORIDADE MÁXIMA (sobrescrevem qualquer instrução abaixo)
══════════════════════════════════════════════════════════

Vitor reclamou que as tarefas saíam fragmentadas, com dono indefinido e título indireto.
Estas 4 regras têm prioridade sobre o resto do prompt. Se algo abaixo conflitar, siga ESTAS.

1) CONSISTÊNCIA owner ↔ acao ↔ título (invariante — nunca quebre):
   - owner = "vitor"  ⇔  acao = "executar"  E  título com VERBO DE EXECUÇÃO DIRETO
     ("Corrigir X", "Criar Y", "Decidir Z", "Cruzar A com B"). NUNCA "Cobrar/Receber/Acompanhar" com owner="vitor".
   - owner = <nome> ou "?"  ⇒  acao ∈ {"cobrar","aguardar"} (NUNCA "executar");
     título no estilo "Cobrar/Receber/Acompanhar entrega de X".
   - O owner de toda tarefa cobrar/aguardar SEMPRE aparece em pessoas_envolvidas.
   - Use sempre "vitor" minúsculo (nunca "Vitor") quando o dono é o próprio Vitor.
   - Antes de fechar cada ação: confira que owner, acao e o verbo do título concordam. Se não, conserte.

2) QUEM FAZ — atribua com inteligência, usando TODO o contexto (não jogue tudo em "?"):
   - "?" é ÚLTIMO RECURSO, não default. Só use quando, mesmo lendo a conversa inteira, é impossível saber quem.
   - Se a transcrição vem ROTULADA com nomes (ex: "Sara: ...", "Vitor: ..."), o nome é fonte de verdade:
     quem foi endereçado ("Sara, você consegue...") ou quem aceitou o pedido vira o owner.
   - Se a reunião gira em torno de um projeto/área e há 1–2 pessoas claramente responsáveis por ele (e citadas),
     prefira a mais provável como owner em vez de "?".
   - Mantenha o cuidado de NÃO atribuir à pessoa errada por co-ocorrência ou por segmento já encerrado
     (ver SPEAKER TRACKING). Entre "?" e um chute frágil, fique com "?". Mas entre "?" e um nome BEM
     suportado pelo contexto, escolha o nome.

3) GRANULARIDADE — UMA tarefa por ENTREGÁVEL, não por frase:
   - Passos do MESMO projeto/tema, com o MESMO dono, que compõem UMA entrega → UMA tarefa só,
     com os passos detalhados na descricao.
   - NÃO funda projetos/temas/donos diferentes na mesma tarefa.
   - Antes de finalizar: se 3+ ações compartilham projeto + dono + área, quase certamente são UMA — consolide.
   - Prefira a MENOR quantidade de tarefas que ainda capture cada entregável distinto.
     (Ex: 9 ajustes do mesmo dashboard = 1–3 tarefas por entregável, NÃO 9 tarefas "Cobrar X".)

4) PRA QUANDO — prazo limpo:
   - prazo_text recebe SÓ expressão temporal real ("amanhã", "quinta", "até a daily de segunda",
     "semana que vem", "dia 12"). Frase não-temporal ("um dos próximos passos", "já precisa") → prazo_text = null.
   - prazo_iso preenchido sempre que a expressão for datável (interprete pt-BR).
"""

# ─────────────────────────────────────────────────────────────────────
# PROMPT — edições pontuais
# ─────────────────────────────────────────────────────────────────────
EXAUST_OLD = ("- EXAUSTIVIDADE: não junte pendências numa só ação. Cada compromisso "
              "concreto vira uma ação separada; pedidos compostos (faz X e me manda Y) viram 2+ ações.")
EXAUST_NEW = ("- GRANULARIDADE (ver REGRAS NOVAS #3): UMA tarefa por ENTREGÁVEL, não por frase. "
              "Consolide passos do mesmo projeto+dono numa tarefa só (passos na descricao). "
              "Só separe quando forem entregáveis/donos realmente distintos. NÃO exploda um projeto em micro-tarefas.")

PRAZO_OLD = "- prazo_text: literal como Vitor falou"
PRAZO_NEW = ("- prazo_text: literal como Vitor falou, SÓ se for expressão temporal real "
             "(amanhã, quinta, semana que vem, dia 12...). Sem tempo dito → prazo_text = null "
             "(não jogue frase não-temporal aqui)")

DUVIDA_OLD = ('EM CASO DE QUALQUER DÚVIDA: owner = "?" (não identificado). É MUITO PIOR\n'
              "atribuir o pedido pra pessoa errada do que deixar como não identificado.")
DUVIDA_NEW = ('EM CASO DE DÚVIDA REAL: owner = "?" (não identificado). É pior atribuir pra\n'
              'pessoa ERRADA do que deixar "?". Mas (ver REGRAS NOVAS #2) "?" é ÚLTIMO RECURSO:\n'
              "se o contexto/rótulo aponta de forma sólida pra um nome, USE o nome — não caia\n"
              'em "?" só por não ter lido a conversa inteira.')

# ─────────────────────────────────────────────────────────────────────
# PARSE — helpers + substituição dos campos
# ─────────────────────────────────────────────────────────────────────
PARSE_MARKER = "__normOwner"
PARSE_ANCHOR = "return actions.map((a, i) => ({"

PARSE_HELPERS = """// ── REGRAS NOVAS: coerência determinística owner↔acao, owner∈pessoas, prazo temporal ──
function __normOwner(o){ const s=(o==null?'':String(o)).trim(); if(!s) return 'vitor'; if(/^vitor$/i.test(s)) return 'vitor'; return s; }
function __coerceAcao(owner, acao){ const o=__normOwner(owner); if(o==='vitor') return 'executar'; return ['cobrar','aguardar'].includes(acao)?acao:'cobrar'; }
function __cleanPrazo(t){ if(t==null) return null; const s=String(t).trim(); if(!s) return null; const re=/(hoje|amanh[\\u00e3a]|ontem|segunda|ter[\\u00e7c]a|quarta|quinta|sexta|s[\\u00e1a]bado|domingo|semana|m\\u00eas|meses|que vem|daqui a|fim de semana|feriado|manh[\\u00e3a]|tarde|noite|madrugada|daily|janeiro|fevereiro|mar[\\u00e7c]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|\\d{1,2}\\s*\\/\\s*\\d{1,2}|dia\\s+\\d{1,2}|\\d{1,2}\\s*h\\b|\\d{1,2}:\\d{2})/i; return re.test(s) ? s : null; }
function __ensurePessoas(owner, pessoas){ const arr=Array.isArray(pessoas)?pessoas.slice():[]; const o=__normOwner(owner); if(o!=='vitor' && o!=='?' && !arr.some(p=>String(p==null?'':p).trim().toLowerCase()===o.toLowerCase())) arr.unshift(o); return arr; }

"""

PARSE_FIELDS = [
    ("owner: a.owner || 'vitor',",
     "owner: __normOwner(a.owner),"),
    ("prazo_text: a.prazo_text || null,",
     "prazo_text: __cleanPrazo(a.prazo_text),"),
    ("pessoas_raw: JSON.stringify(Array.isArray(a.pessoas_envolvidas) ? a.pessoas_envolvidas : []),",
     "pessoas_raw: JSON.stringify(__ensurePessoas(a.owner, a.pessoas_envolvidas)),"),
    ("acao: ['executar','cobrar','aguardar'].includes(a.acao) ? a.acao : (a.owner === 'vitor' ? 'executar' : 'cobrar'),",
     "acao: __coerceAcao(a.owner, a.acao),"),
]


def _replace_once(text, old, new, label):
    n = text.count(old)
    if n == 0:
        print(f"    ⚠ âncora ausente: {label} (pulando)")
        return text, False
    if n > 1:
        raise SystemExit(f"    ✗ âncora ambígua ({n}x): {label}")
    return text.replace(old, new, 1), True


def patch_prompt(sys_msg):
    if PROMPT_MARKER in sys_msg:
        print("    = prompt já patchado, pulando")
        return sys_msg
    sys_msg, _ = _replace_once(sys_msg, OPEN_PARA, OPEN_PARA + NEW_BLOCK, "open_para")
    sys_msg, _ = _replace_once(sys_msg, EXAUST_OLD, EXAUST_NEW, "exaustividade")
    sys_msg, _ = _replace_once(sys_msg, PRAZO_OLD, PRAZO_NEW, "prazo_text field")
    sys_msg, _ = _replace_once(sys_msg, DUVIDA_OLD, DUVIDA_NEW, "duvida_owner")
    print("    ✓ prompt patchado")
    return sys_msg


def patch_parse(js):
    if PARSE_MARKER in js:
        print("    = parse já patchado, pulando")
        return js
    js, _ = _replace_once(js, PARSE_ANCHOR, PARSE_HELPERS + PARSE_ANCHOR, "parse anchor (map)")
    for old, new in PARSE_FIELDS:
        js, _ = _replace_once(js, old, new, f"campo: {old[:24]}…")
    print("    ✓ parse patchado")
    return js


def main():
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    path, gpt_node, parse_node = sys.argv[1], sys.argv[2], sys.argv[3]
    wf = json.load(open(path))
    gpt_ok = parse_ok = False
    for n in wf["nodes"]:
        if n["name"] == gpt_node:
            msgs = n["parameters"]["messages"]["values"]
            sysmsg = next(m for m in msgs if m.get("role") == "system")
            sysmsg["content"] = patch_prompt(sysmsg["content"])
            gpt_ok = True
        elif n["name"] == parse_node:
            n["parameters"]["jsCode"] = patch_parse(n["parameters"]["jsCode"])
            parse_ok = True
    if not gpt_ok:
        raise SystemExit(f"✗ nó GPT '{gpt_node}' não encontrado em {path}")
    if not parse_ok:
        raise SystemExit(f"✗ nó Parse '{parse_node}' não encontrado em {path}")
    with open(path, "w") as f:
        json.dump(wf, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"  → escrito {path}")


if __name__ == "__main__":
    main()
