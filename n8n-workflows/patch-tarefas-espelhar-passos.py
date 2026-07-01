#!/usr/bin/env python3
"""Patch: tarefas ESPELHAM os "Próximos passos" (julho/2026).

Vitor: "os Próximos passos do resumo saem MUITO melhores que as tarefas — mais
diretos e fáceis de entender". Diagnóstico: no fluxo de 2 estágios (Stage A ->
Distiller), o Distiller destruía a granularidade/clareza dos Próximos passos por
(a) TETO ~5 + CONSOLIDE-tudo-numa e (b) título "curto, infinitivo". E o Judge
reescrevia o título em canonical "curto, no infinitivo" — segunda fonte de dano.

Este patch, nos 4 workflows:
  - Distiller (system): novo prompt — cada Próximo passo = 1 tarefa, título direto
    e autossuficiente, âncora de granularidade no nº de Próximos passos (nem funde
    temas distintos, nem fragmenta um passo em vários), sem teto artificial.
  - Build Judge Prompt (jsCode): canonical passa de "título curto, no infinitivo"
    para "frase direta e completa, escolhendo a redação mais completa entre os membros".

Idempotente (detecta se já aplicado). Novo prompt lido de .distiller_sys_new.txt.
Depois: `source .env && ./apply.sh`.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
FILES = ["acoes-process-segment.json", "acoes-audio-ingest.json",
         "acoes-reprocess-tarefas.json", "acoes-reprocess-meeting.json"]

NEW_DISTILLER = open(os.path.join(HERE, ".distiller_sys_new.txt")).read()
DISTILLER_MARKER = "ESPELHE OS \"PRÓXIMOS PASSOS\""

JUDGE_OLD = 'Para cada grupo dê "canonical" (título curto, no infinitivo) '
JUDGE_NEW = ('Para cada grupo dê "canonical" — uma FRASE DIRETA E COMPLETA no estilo do próprio '
             'título (verbo no infinitivo + o ENTREGÁVEL CONCRETO), escolhendo/unindo a redação '
             'MAIS COMPLETA entre os membros; NÃO encurte para rótulo genérico ')


def replace_value_in_raw(raw: str, old_str: str, new_str: str) -> str:
    """Troca o valor JSON old_str -> new_str no texto cru (diff mínimo)."""
    frag_old = json.dumps(old_str, ensure_ascii=False)
    frag_new = json.dumps(new_str, ensure_ascii=False)
    if raw.count(frag_old) != 1:
        raise SystemExit(f"  !! esperava 1 ocorrência do fragmento, achei {raw.count(frag_old)}")
    return raw.replace(frag_old, frag_new)


def main():
    for f in FILES:
        path = os.path.join(HERE, f)
        raw = open(path, encoding="utf-8").read()
        d = json.loads(raw)
        distiller = next(n for n in d["nodes"] if n["name"] == "Distiller")
        judge = next(n for n in d["nodes"] if n["name"] == "Build Judge Prompt")
        old_sys = distiller["parameters"]["messages"]["values"][0]["content"]
        old_js = judge["parameters"]["jsCode"]

        changed = []
        # 1) Distiller system
        if DISTILLER_MARKER in old_sys:
            print(f"{f}: Distiller já espelha passos — pulando")
        else:
            raw = replace_value_in_raw(raw, old_sys, NEW_DISTILLER)
            changed.append("distiller")
        # 2) Judge canonical
        if JUDGE_OLD in old_js:
            new_js = old_js.replace(JUDGE_OLD, JUDGE_NEW)
            raw = replace_value_in_raw(raw, old_js, new_js)
            changed.append("judge")
        elif JUDGE_NEW.strip() in old_js:
            print(f"{f}: Judge canonical já atualizado — pulando")
        else:
            print(f"{f}: !! marcador do Judge não encontrado")

        if changed:
            json.loads(raw)  # valida que continua JSON válido
            open(path, "w", encoding="utf-8").write(raw)
            print(f"{f}: aplicado -> {', '.join(changed)}")


if __name__ == "__main__":
    main()
