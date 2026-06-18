#!/usr/bin/env python3
"""Amplia o escopo da extração (junho/2026): captura tarefas de TODOS os
participantes da conversa (não só do Vitor), com o dono real e acao inferida.

Vitor é Diretor e grava reuniões pra ter visibilidade de quem-deve-o-quê. Antes,
o prompt só extraía tarefas do Vitor → reuniões observadas (ex.: dois devs
alinhando) voltavam 0. Agora extrai as tarefas dos participantes com owner=pessoa.

Uso: python3 patch-tarefas-scope.py <arquivo.json> <gpt_node_name>
Idempotente. Depois: source .env && ./apply.sh
"""
import json, sys

SCOPE_MARKER = "CAPTURE TAREFAS DE TODOS"
ANCHOR = "   - prazo_iso preenchido sempre que a expressão for datável (interprete pt-BR)."

RULE5 = ANCHOR + """

5) CAPTURE TAREFAS DE TODOS OS PARTICIPANTES — não só do Vitor (ESCOPO AMPLIADO):
   Vitor é Diretor e grava conversas/reuniões pra ter VISIBILIDADE de quem-deve-o-quê no time.
   Extraia TODA ação concreta combinada na conversa, mesmo quando o dono NÃO é o Vitor.
   - Reunião OBSERVADA (Vitor só gravou; ex.: dois devs alinhando, time discutindo) → SIM, extraia
     as tarefas dos PARTICIPANTES. NUNCA retorne 0 só porque o Vitor não fala. Quem se comprometeu
     ou recebeu a tarefa é o owner.
   - owner = a pessoa REAL que vai executar (nome do falante identificado ou de quem foi endereçado;
     "?" só quando é impossível saber quem).
   - acao do PONTO DE VISTA DO VITOR (infira pelo contexto):
       • dono = "vitor"                                              → executar
       • tarefa de outro que o Vitor vai acompanhar/cobrar de perto  → cobrar
       • tarefa de outro que roda sozinha; Vitor só quer VISIBILIDADE → aguardar
   - Continua valendo o teste pragmático: extraia COMPROMISSOS concretos (entregáveis, decisões com
     dono), NÃO todo comentário de passagem nem papo aleatório (futebol, piada, conversa fiada).
   - Invariante (regra #1) intacto: owner="vitor" ⇔ executar; owner≠"vitor" ⇒ cobrar/aguardar."""

AGUARDAR_OLD = ('- "aguardar" — outra pessoa executa e Vitor explicitamente NÃO vai cobrar '
                "(delegação com autonomia total, decisão tomada entre terceiros sem Vitor participar "
                'do follow-up, ou compromisso de outra pessoa que não impacta Vitor). É RARO. Use só '
                'quando o texto deixa evidente que Vitor "soltou" a responsabilidade.')
AGUARDAR_NEW = ('- "aguardar" — outra pessoa executa e Vitor só ACOMPANHA / quer visibilidade '
                "(não vai cobrar de perto). É COMUM em reuniões de time/observadas (tarefas dos "
                'outros que você só quer ver). Use também quando Vitor "soltou" a responsabilidade.')


def _replace_once(text, old, new, label):
    n = text.count(old)
    if n != 1:
        raise SystemExit(f"    ✗ âncora {label}: esperava 1, achei {n}")
    return text.replace(old, new, 1)


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    path, gpt_node = sys.argv[1], sys.argv[2]
    wf = json.load(open(path))
    found = False
    for n in wf["nodes"]:
        if n["name"] == gpt_node:
            msgs = n["parameters"]["messages"]["values"]
            sm = next(m for m in msgs if m.get("role") == "system")
            s = sm["content"]
            if SCOPE_MARKER in s:
                print(f"  = {path}: escopo já ampliado, pulando")
                return
            s = _replace_once(s, ANCHOR, RULE5, "rule4 end")
            s = _replace_once(s, AGUARDAR_OLD, AGUARDAR_NEW, "aguardar def")
            sm["content"] = s
            found = True
    if not found:
        raise SystemExit(f"✗ nó GPT '{gpt_node}' não encontrado em {path}")
    with open(path, "w") as f:
        json.dump(wf, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"  ✓ {path} — escopo ampliado")


if __name__ == "__main__":
    main()
