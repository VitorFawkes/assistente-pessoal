#!/usr/bin/env python3
"""
Centro de Comando dos agentes Claude Code — backend (FastAPI).

Você CONVERSA com o MAESTRO (Opus 4.8) por voz/texto: ele investiga seus projetos e
RESPONDE em áudio, e EXECUTA o que você pedir (roda comandos, edita) ou delega abrindo
AGENTES dedicados. Tudo claude-agent-sdk, seu login, SEM API key.

Roda na venv de voz: ~/.claude/voice/.venv.
"""
import os
import json
import uuid
import asyncio
import difflib
import tempfile
import subprocess
import urllib.request
from pathlib import Path
from contextlib import asynccontextmanager

os.environ["CLAUDE_VOICE_INTERNAL"] = "1"  # agentes do maestro NÃO disparam o hook-notifier

from fastapi import FastAPI, UploadFile, File, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse, JSONResponse
from claude_agent_sdk import (
    ClaudeSDKClient, ClaudeAgentOptions, AssistantMessage, TextBlock, StreamEvent,
    UserMessage, HookMatcher, tool, create_sdk_mcp_server,
)
import re

HERE = Path(__file__).parent
STATIC = HERE / "static"
UPLOADS = HERE / "uploads"          # imagens coladas/arrastadas no painel (o agente lê via Read)
SESSION_ACTIVE_WINDOW = 25          # s desde a última escrita do transcript p/ uma sessão VS Code contar como "rodando" (senão "aberta")
PIPER_PORT = int(os.environ.get("CLAUDE_VOICE_PORT", "8765"))
MAESTRO_MODEL = os.environ.get("CC_MAESTRO_MODEL", "claude-opus-4-8")
WORKER_MODEL = os.environ.get("CC_MODEL", "claude-sonnet-4-6")
WHISPER_MODEL = os.environ.get("CC_WHISPER", "small")    # 'small' é leve; o viés de vocabulário (initial_prompt) já melhora nomes. 'medium' custa ~1GB RAM — só se sobrar memória.

# Robustez. Mission Control roda SEM teto de agentes (igual VS Code: você gerencia sua própria carga).
#  - CC_MAX_CONCURRENT: teto OPCIONAL de agentes executando ao mesmo tempo. 0 = ilimitado (padrão). Suba só se quiser um freio numa máquina apertada.
#  - CC_STALL_SECS: se um agente ficar esse tanto SEM emitir NENHUMA mensagem, considera travado -> marca erro (recuperável), em vez de 'working' eterno e incancelável.
CC_MAX_CONCURRENT = int(os.environ.get("CC_MAX_CONCURRENT", "0"))
CC_STALL_SECS = int(os.environ.get("CC_STALL_SECS", "240"))

# Esforço/reasoning REAL do SDK (ClaudeAgentOptions.effort):
#   low | medium | high (default) | xhigh ("extra alto") | max — xhigh/max nos Opus 4.x.
EFFORT_LEVELS = ("low", "medium", "high", "xhigh", "max")
MAESTRO_EFFORT = os.environ.get("CC_MAESTRO_EFFORT", "low")
_EFFORT_ALIASES = {"baixo": "low", "médio": "medium", "medio": "medium", "alto": "high",
                   "extra alto": "xhigh", "extra-alto": "xhigh", "máximo": "max",
                   "maximo": "max", "normal": "high"}


def norm_effort(v, default="high"):
    v = (v or "").strip().lower()
    v = _EFFORT_ALIASES.get(v, v)
    return v if v in EFFORT_LEVELS else default
# Agentes = Claude Code real (tools=preset claude_code). Estes são auto-aprovados (sem prompt);
# Bash entra pelo gate destrutivo (hook); MCP/resto seguem as permissions.allow do usuário.
AGENT_AUTO_TOOLS = ["Read", "Grep", "Glob", "WebSearch", "WebFetch", "Write", "Edit", "MultiEdit",
                    "NotebookEdit", "Task", "Skill", "TodoWrite"]
# Maestro só CONDUZ: nada de ler/editar/rodar — apenas as ferramentas de orquestração.
MAESTRO_TOOLS = ["mcp__maestro__spawn_agent", "mcp__maestro__instruct_agent",
                 "mcp__maestro__control", "mcp__maestro__fleet_status"]
DESTRUCTIVE = ("rm -rf", "rm -fr", "sudo ", "dd if=", "mkfs", ":(){", "> /dev/",
               "git push --force", "git push -f", "reset --hard", "shutdown", "reboot")
READONLY = {"ls", "cat", "head", "tail", "grep", "rg", "find", "pwd", "echo", "wc", "which",
            "ps", "df", "du", "date", "env", "tree", "stat", "file", "cut", "sort", "uniq",
            "ripgrep", "fd", "bat", "column", "basename", "dirname", "realpath"}
GIT_RO_SUB = {"status", "log", "diff", "show", "branch", "remote", "rev-parse", "ls-files",
              "describe", "blame", "config", "shortlog", "tag"}
GIT_RW_SUB = {"push", "commit", "reset", "checkout", "merge", "rebase", "clean", "rm", "mv",
              "add", "stash", "apply", "restore", "switch", "cherry-pick", "revert", "init", "clone"}
_SENT = re.compile(r"(?<=[.!?…])\s+")
_MD = re.compile(r"```.*?```|`[^`]+`|\*\*([^*]+)\*\*|\*([^*]+)\*|__([^_]+)__|_([^_]+)_|^\s*#{1,6}\s+|^\s*[-*+]\s+|^\s*\d+\.\s+|^\|.*\|$|^-{3,}$|[#*_`>~|]", re.DOTALL | re.MULTILINE)

# Anexo ao system prompt REAL do Claude Code (preset). NÃO substitui — só acrescenta.
PANEL_NOTE = (
    "\n\n[CONTEXTO DO PAINEL] Você está sendo orquestrado por um painel de voz (um Maestro relê seu "
    "resultado em áudio pro usuário). Antes de concluir a tarefa, rode o lint/typecheck do projeto se "
    "houver e corrija erros novos que você introduziu. Ao terminar, finalize com um resumo BREVE "
    "(1-2 frases), em pt-BR falado e natural, do que fez e se precisa de algo do usuário."
)

_stt = None
# Limita quantos agentes executam tarefa AO MESMO TEMPO (evita saturar RAM/CPU). None = ilimitado.
_RUN_SEM = asyncio.Semaphore(CC_MAX_CONCURRENT) if CC_MAX_CONCURRENT > 0 else None


@asynccontextmanager
async def _run_slot():
    """Vaga de execução. No-op quando CC_MAX_CONCURRENT=0 (ilimitado)."""
    if _RUN_SEM is None:
        yield
    else:
        async with _RUN_SEM:
            yield


AGENTS = {}          # id -> Agent
PENDING = {}         # approval_id -> (obj, Future, dict)
WS = set()
PROJECTS = {}
STATE = {"autonomy": "cauteloso", "audio": True,   # toggles globais do painel
         # Chaves de VOZ (independentes): o que o Maestro FALA. OFF = só aparece no rail/feed,
         # sem áudio. 'audio' é o mute mestre por cima destas.
         "speak_replies": True,     # respostas aos meus pedidos
         "speak_done": True,        # quando um agente termina
         "speak_alerts": True}      # aprovação / erro / plano pendente
FEED = []            # eventos recentes (mais novo primeiro), capado
_FEED_SEQ = [0]
MAESTRO_CONVO = []   # histórico da conversa/ações do Maestro (mais antigo primeiro), capado


def _now():
    import time as _t
    return _t.time()


def _hhmm():
    import time as _t
    return _t.strftime("%H:%M")


# ----------------------------------------------------------------- util
def discover_projects():
    out = {}
    for r in [Path.home() / "Documents", Path.home()]:
        try:
            for p in r.iterdir():
                if p.is_dir() and not p.name.startswith(".") and (p / ".git").exists():
                    out[p.name] = str(p)
        except Exception:
            pass
    for extra in [Path.home() / "AssistentePessoal", Path.home() / "Documents/we.wedme",
                  Path.home() / "Documents/WelcomeCRM"]:
        if extra.exists():
            out[extra.name] = str(extra)
    return out


def _sub_readonly(p: str) -> bool:
    p = p.strip()
    if not p or p.startswith("cd ") or p == "cd":
        return True
    # redirecionar/descartar stderr é seguro (não escreve arquivo) — não tratar como escrita
    pp = re.sub(r"\d*>\s*&\s*\d+|\d*>\s*/dev/null", "", p)
    if ">" in pp or "| tee" in pp or " -i " in pp:
        return False
    toks = p.split()
    first = toks[0]
    if first == "git":
        sub, i = None, 1
        while i < len(toks):                 # pula -C <path> e -c k=v
            t = toks[i]
            if t == "-C":
                i += 2; continue
            if t.startswith("-"):
                i += 1; continue
            sub = t; break
        if sub in GIT_RW_SUB:
            return False
        return sub in GIT_RO_SUB
    return first in READONLY


def is_readonly_bash(cmd: str) -> bool:
    parts = re.split(r"&&|\|\||;|\|", cmd.strip())
    return all(_sub_readonly(p) for p in parts if p.strip())


def daemon_stop():
    """PÂNICO: pede pro daemon de voz matar a fala atual + esvaziar a fila."""
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{PIPER_PORT}/stop", timeout=2)
    except Exception:
        pass


def set_mute(on):
    mp = Path.home() / ".claude/voice/MUTE"
    try:
        if on:
            mp.write_text("1")
        else:
            mp.unlink()
    except Exception:
        pass


def speak(text, sid="maestro"):
    if not STATE.get("audio", True):      # modo texto: não fala
        return
    text = _MD.sub(
        lambda m: " " + (m.group(1) or m.group(2) or m.group(3) or m.group(4) or "") + " ",
        text or ""
    ).strip()
    # Cinto-e-suspensório: o Maestro não deve falar URLs/paths nus — se escaparem, some com eles.
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"(?:~|\.?/)?[\w.\-]+(?:/[\w.\-]+){2,}", " ", text)   # paths multi-segmento
    # Normalizar espaços múltiplos e limpar início de linha
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"\n{2,}", ". ", text).replace("\n", " ").strip()
    if not text:
        return
    def _post():
        try:
            data = json.dumps({"text": text, "session_id": sid}).encode()
            req = urllib.request.Request(f"http://127.0.0.1:{PIPER_PORT}/speak", data=data,
                                         headers={"content-type": "application/json"}, method="POST")
            urllib.request.urlopen(req, timeout=4)
        except Exception:
            pass
    try:
        asyncio.get_event_loop().run_in_executor(None, _post)
    except Exception:
        _post()


def _spoken_tail(text, limit=600):
    """Pega a CAUDA do texto do agente — onde fica o resumo falado de 1-2 frases pedido no
    PANEL_NOTE — em vez do muro técnico inteiro, cortando numa fronteira de frase pra não
    começar no meio de uma palavra/linha. É isso que sobe pro Maestro reler em voz."""
    t = (text or "").strip()
    if len(t) <= limit:
        return t
    tail = t[-limit:]
    m = re.search(r"[.!?…\n]\s+", tail)
    return (tail[m.end():].strip() if m else tail.lstrip())


async def broadcast(msg: dict):
    dead = []
    for ws in list(WS):
        try:
            await ws.send_text(json.dumps(msg))
        except Exception:
            dead.append(ws)
    for d in dead:
        WS.discard(d)


async def broadcast_agent(ag):
    await broadcast({"type": "agent_update", "agent": ag.public()})
    _save_throttled()


async def add_feed(kind, proj, text):
    """Evento pro feed de atividade ao vivo. kind: working|done|error|paused|waiting|maestro."""
    _FEED_SEQ[0] += 1
    item = {"id": f"f{_FEED_SEQ[0]}", "at": int(_now() * 1000), "kind": kind,
            "proj": proj, "text": text}
    FEED.insert(0, item)
    del FEED[60:]
    await broadcast({"type": "feed", "item": item})


def convo_push(kind, text, ts=None):
    """Aterra um turno/ação do Maestro no histórico, pra sobreviver a refresh da página.
    Carimba o horário (epoch ms) pra mostrar dia+hora na caixa de diálogo. Devolve o ts."""
    text = (text or "").strip()
    if not text:
        return None
    ts = ts if ts is not None else int(_now() * 1000)
    MAESTRO_CONVO.append({"kind": kind, "text": text, "ts": ts})
    del MAESTRO_CONVO[:-200]
    return ts


# ----------------------------------------------------------------- gate de Bash (PreToolUse)
def _allow():
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow"}}


def _deny(reason):
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse",
            "permissionDecision": "deny", "permissionDecisionReason": reason}}


# modos que rodam comando mutante sem pedir aprovação (destrutivo continua sempre bloqueado)
_AUTONOMOUS_MODES = ("acceptEdits", "auto", "dontAsk", "bypassPermissions")


def make_pre_hook(owner_id, owner_project):
    async def pre(inp, tool_use_id, context):
        tn = inp.get("tool_name") if isinstance(inp, dict) else getattr(inp, "tool_name", None)
        ti = (inp.get("tool_input") if isinstance(inp, dict) else getattr(inp, "tool_input", None)) or {}
        ag = AGENTS.get(owner_id)
        # PLAN MODE: agente terminou o plano -> mostra na tela + aprovação (voz/clique)
        if tn == "ExitPlanMode":
            plan = ti.get("plan", "") or ""
            apid = uuid.uuid4().hex[:8]
            fut = asyncio.get_running_loop().create_future()
            since = _now()
            PENDING[apid] = (owner_id, fut, {"tool": "ExitPlanMode", "preview": plan[:300], "since": since})
            cur = ag.current() if ag else None
            if cur:
                cur.status = "waiting"; cur.last_text = plan
                cur.add_log("plano pronto — aguardando aprovação", "warn")
                await broadcast_agent(ag)
            await broadcast({"type": "plan_ready", "id": apid, "agent_id": owner_id,
                             "project": owner_project, "plan": plan, "since": since})
            await maestro_inbox.put({"type": "event", "kind": "plan_ready", "project": owner_project})
            try:
                ok = await asyncio.wait_for(fut, timeout=90)
            except asyncio.TimeoutError:
                ok = False
            PENDING.pop(apid, None)
            await broadcast({"type": "approval_resolved", "approval_id": apid})
            if ok:
                ag.permission_mode = "acceptEdits"
                if ag.client:
                    try:
                        await ag.client.set_permission_mode("acceptEdits")
                    except Exception:
                        pass
                if cur:
                    cur.status = "working"; await broadcast_agent(ag)
                return _allow()
            return _deny("Plano não aprovado pelo Vitor.")
        if tn != "Bash":
            return {}
        cmd = ti.get("command", "")
        if any(b in cmd for b in DESTRUCTIVE):
            return _deny("Comando destrutivo bloqueado (sempre barrado pelo painel).")
        mode = ag.permission_mode if ag else "default"
        # read-only sempre livre; modos autônomos rodam mutante direto; em PLAN o agente é read-only
        # no SDK (não edita), então liberamos o Bash de exploração — a aprovação é do PLANO (ExitPlanMode).
        if is_readonly_bash(cmd) or mode in _AUTONOMOUS_MODES or mode == "plan":
            return _allow()
        apid = uuid.uuid4().hex[:8]
        fut = asyncio.get_running_loop().create_future()
        preview = cmd[:200]
        since = _now()
        PENDING[apid] = (owner_id, fut, {"tool": "Bash", "preview": preview, "since": since})
        await broadcast({"type": "approval", "approval": {
            "id": apid, "agent_id": owner_id, "project": owner_project,
            "tool": "Bash", "preview": preview, "since": since}})
        cur = ag.current() if ag else None
        if cur:                       # a tarefa em execução fica "aguardando" sua decisão (visual)
            cur.status = "waiting"
            cur.add_log("aguardando sua aprovação", "warn")
            await broadcast_agent(ag)
        # Maestro AVISA por voz (humano, sem ler o comando inteiro)
        await maestro_inbox.put({"type": "event", "kind": "needs_approval",
                                 "project": owner_project, "preview": preview})
        try:
            ok = await asyncio.wait_for(fut, timeout=90)
        except asyncio.TimeoutError:
            ok = False
        PENDING.pop(apid, None)
        await broadcast({"type": "approval_resolved", "approval_id": apid})
        if cur and cur.status == "waiting":
            cur.status = "working"
            await broadcast_agent(ag)
        return _allow() if ok else _deny("Negado/sem aprovação.")
    return pre


async def maestro_guard(inp, tool_use_id, context):
    """O Maestro só conduz: nega QUALQUER ferramenta que não seja de orquestração
    (mcp__maestro__*). Ele nunca lê arquivo, roda git ou edita — quem faz é o agente."""
    tn = inp.get("tool_name") if isinstance(inp, dict) else getattr(inp, "tool_name", None)
    if tn and tn.startswith("mcp__maestro__"):
        return _allow()
    return _deny("O Maestro não executa: delegue a um agente (spawn_agent/instruct_agent).")


# ----------------------------------------------------------------- worker agents (projeto → agente → tarefas)
# status de tarefa: queued | working | waiting | paused | done | error
class Task:
    def __init__(self, title):
        self.id = uuid.uuid4().hex[:8]
        self.title = title
        self.status = "queued"
        self.log = []
        self.last_text = ""        # saída ao vivo do agente nesta tarefa
        self.created_at = _now()
        self.started_at = None
        self.ended_at = None
        self.cancel = False        # pedido de interrupção
        self.checkpoint_id = None  # uuid da UserMessage (pra rewind/desfazer)
        self.events = []           # timeline de ações (tool-use) — Fase 3
        self.cost = None           # custo $ da tarefa — Fase 3
        self.files = []            # arquivos mexidos — Fase 3

    def add_log(self, text, k=""):
        self.log.append({"t": _hhmm(), "k": k, "text": text})
        del self.log[:-12]

    def elapsed(self):
        if not self.started_at:
            return 0
        return int((self.ended_at or _now()) - self.started_at)

    def public(self):
        return {"id": self.id, "title": self.title, "status": self.status,
                "log": self.log[-6:], "last_text": self.last_text[-1500:],
                "elapsed": self.elapsed(), "events": self.events[-12:],
                "files": self.files, "cost": self.cost,
                "can_undo": bool(self.checkpoint_id and self.files),
                # timestamps crus (epoch SEGUNDOS) — front ordena/relógio/duração/1º-último
                "created_at": self.created_at, "started_at": self.started_at, "ended_at": self.ended_at}


PERMISSION_MODES = ("default", "acceptEdits", "plan", "auto", "dontAsk")


def norm_pmode(v, default="default"):
    v = (v or "").strip()
    return v if v in PERMISSION_MODES else default


# rótulo curto pra distinguir vários agentes do MESMO projeto (no card e pra voz do Maestro)
_LABEL_STOP = {"o", "a", "os", "as", "no", "na", "nos", "nas", "de", "do", "da", "dos", "das",
               "pra", "para", "e", "em", "um", "uma", "que", "com", "ao", "à", "o(s)", "se"}


def _derive_label(task_title):
    """Apelido curto (~24c) do que o agente faz, a partir da 1ª tarefa. '' se vazio."""
    words = [w for w in re.split(r"\s+", (task_title or "").strip()) if w]
    keep = [w for w in words if w.lower().strip(".,;:!?") not in _LABEL_STOP] or words
    label = " ".join(keep[:3]).strip(".,;:!?").lower()
    return label[:24].strip()


def _unique_label(project, base, exclude_id=None):
    """Garante rótulo único DENTRO do projeto (sufixa ' 2', ' 3'… se colidir)."""
    base = (base or "").strip()
    existing = {a.label.lower() for a in AGENTS.values()
                if a.project == project and a.label and a.id != exclude_id}
    if not base:
        return base
    if base.lower() not in existing:
        return base
    i = 2
    while f"{base} {i}".lower() in existing:
        i += 1
    return f"{base} {i}"


class Agent:
    def __init__(self, project, cwd, model, effort="high", permission_mode="default"):
        self.id = uuid.uuid4().hex[:8]
        self.project = project
        self.label = ""                  # apelido curto (distingue vários agentes do mesmo projeto)
        self.cwd = cwd
        self.model = model
        self.effort = norm_effort(effort)
        self.permission_mode = norm_pmode(permission_mode)
        self.paused = False
        self.tasks = []                  # list[Task]
        self.wake = asyncio.Event()      # acorda o runner quando há tarefa nova/retomada
        self.client = None               # set no runner (pra interrupt())
        self.stopped = False
        self.runner_task = None          # task do runner (pra reiniciar ao trocar esforço)
        self.session_id = None           # id da sessão claude (pra retomar) — Fase 4
        self.live = True                 # runner ativo? (False = dormente, precisa retomar)
        self.context = None              # {pct, tokens, max} — Fase 3 (get_context_usage)
        self.created_at = _now()         # epoch do spawn — pra ordenar agentes no tempo

    def total_cost(self):
        c = sum(t.cost for t in self.tasks if t.cost)
        return round(c, 4) if c else None

    def add_task(self, title):
        t = Task(title)
        self.tasks.append(t)
        self.wake.set()
        return t

    def current(self):
        for t in self.tasks:
            if t.status == "working":
                return t
        return None

    def find_task(self, tid):
        return next((t for t in self.tasks if t.id == tid), None)

    def status(self):
        present = {t.status for t in self.tasks}
        for s in ("error", "working", "waiting", "paused", "queued", "done"):
            if s in present:
                return s
        return "queued"

    def public(self):
        return {"id": self.id, "project": self.project, "label": self.label, "kind": "maestro",
                "model": self.model, "effort": self.effort, "permission_mode": self.permission_mode,
                "paused": self.paused, "live": self.live, "context": self.context, "cost": self.total_cost(),
                "status": self.status(), "tasks": [t.public() for t in self.tasks],
                "cwd": self.cwd, "session_id": self.session_id,
                "created_at": self.created_at}


# ----------------------------------------------------------------- persistência (Fase 4)
# VIDRO: estado próprio via CC_STATE_FILE (independente do Mission Control).
STATE_FILE = Path(os.environ.get("CC_STATE_FILE") or (HERE / "state.json"))
_last_save = [0.0]


def _task_state(t):
    return {"id": t.id, "title": t.title, "status": t.status, "last_text": t.last_text[-2000:],
            "cost": t.cost, "files": t.files, "checkpoint_id": t.checkpoint_id,
            "log": t.log[-6:], "events": t.events[-12:],
            "created_at": t.created_at, "started_at": t.started_at, "ended_at": t.ended_at}


def _agent_state(a):
    return {"id": a.id, "project": a.project, "label": a.label, "cwd": a.cwd, "model": a.model, "effort": a.effort,
            "permission_mode": a.permission_mode, "session_id": a.session_id, "paused": a.paused,
            "created_at": a.created_at,
            "tasks": [_task_state(t) for t in a.tasks]}


def save_state():
    try:
        STATE_FILE.write_text(json.dumps({
            "agents": [_agent_state(a) for a in AGENTS.values()],
            # maestro sobrevive a restart: sessão (pra resume) + conversa visível (rail)
            "maestro": {"sid": maestro_state.get("sid"), "convo": MAESTRO_CONVO[-200:]},
        }))
    except Exception:
        pass


def _save_throttled():
    t = _now()
    if t - _last_save[0] > 3:
        _last_save[0] = t
        save_state()


def load_state():
    if not STATE_FILE.exists():
        return
    try:
        data = json.loads(STATE_FILE.read_text())
    except Exception:
        return
    for ad in data.get("agents", []):
        try:
            ag = Agent(ad["project"], ad["cwd"], ad.get("model") or WORKER_MODEL,
                       effort=ad.get("effort", "high"), permission_mode=ad.get("permission_mode", "default"))
        except Exception:
            continue
        ag.id = ad["id"]; ag.label = ad.get("label", "") or ""
        ag.session_id = ad.get("session_id"); ag.paused = bool(ad.get("paused"))
        ag.created_at = ad.get("created_at") or _now()   # back-compat: state.json antigo sem created_at
        ag.live = False; ag.client = None; ag.tasks = []
        for td in ad.get("tasks", []):
            t = Task(td.get("title", ""))
            t.id = td.get("id", t.id)
            st = td.get("status", "done")
            t.status = "paused" if st in ("working", "waiting") else st   # interrompido -> pausado
            t.last_text = td.get("last_text", "") or ""
            t.cost = td.get("cost"); t.files = td.get("files") or []
            t.checkpoint_id = td.get("checkpoint_id")
            t.log = td.get("log") or []; t.events = td.get("events") or []
            t.created_at = td.get("created_at"); t.started_at = td.get("started_at"); t.ended_at = td.get("ended_at")
            ag.tasks.append(t)
        AGENTS[ag.id] = ag
    # maestro: restaura sessão (pra resume) + conversa visível (rail)
    m = data.get("maestro") or {}
    if m.get("sid"):
        maestro_state["sid"] = m["sid"]
    if m.get("convo"):
        MAESTRO_CONVO.clear()
        MAESTRO_CONVO.extend(m["convo"][-200:])


async def _record_event(ag, task, tool, inp):
    """Registra uma ação (tool-use) na timeline da tarefa + arquivos mexidos. Fase 3."""
    fp = inp.get("file_path") or inp.get("path") or inp.get("notebook_path")
    brief = ""
    if tool == "Bash":
        brief = (inp.get("command", "") or "").replace("\n", " ")[:80]
    elif fp:
        brief = os.path.basename(str(fp))
        if tool in ("Edit", "Write", "MultiEdit", "NotebookEdit") and fp not in task.files:
            task.files.append(fp)
    elif tool == "Task":
        brief = (inp.get("description") or "subagente")[:80]
    elif tool == "Skill":
        brief = str(inp.get("command") or inp.get("skill") or "skill")[:80]
    elif tool.startswith("mcp__"):
        brief = tool.split("__", 2)[-1]
    ev = {"t": _hhmm(), "ts": _now(), "tool": tool, "brief": brief}   # ts (epoch) p/ timeline precisa
    task.events.append(ev)
    del task.events[:-40]
    await broadcast({"type": "task_event", "agent_id": ag.id, "task_id": task.id, "event": ev})


async def _refresh_context(ag, client):
    """Puxa o uso de contexto REAL (mesmo do /context) e guarda no agente. Fase 3."""
    try:
        cu = await client.get_context_usage()
    except Exception:
        return
    if not cu:
        return
    pct = cu.get("percentage")
    tot, mx = cu.get("totalTokens"), cu.get("maxTokens")
    if pct is None and mx:
        pct = (tot or 0) / mx * 100
    ag.context = {"pct": round(pct, 1) if pct is not None else None, "tokens": tot, "max": mx}


async def run_task(ag: "Agent", client, task: "Task"):
    # Respeita o limite de execução simultânea (CC_MAX_CONCURRENT): a tarefa fica 'queued'
    # enquanto espera uma vaga, e só então vira 'working'. Evita saturar RAM/CPU com N agentes.
    async with _run_slot():
        await _run_task_body(ag, client, task)


async def _run_task_body(ag: "Agent", client, task: "Task"):
    task.status = "working"; task.started_at = _now(); task.cancel = False; task.last_text = ""
    task.add_log("iniciada", "")
    await broadcast_agent(ag)
    await client.query(task.title)
    final = ""
    stalled = False
    last_tok = _now()
    pend = None
    try:
        # Em vez de 'async for' (que prende até chegar mensagem), fazemos poll de 4s mantendo
        # o __anext__ vivo entre os polls. Assim: (1) pausa/cancelamento responde em ≤4s mesmo
        # com o stream em silêncio, e (2) se ficar CC_STALL_SECS sem NENHUM token, é travamento.
        ait = client.receive_response().__aiter__()
        pend = asyncio.ensure_future(ait.__anext__())
        while True:
            done, _ = await asyncio.wait({pend}, timeout=4)
            if not done:                                  # 4s sem nenhuma mensagem
                if task.cancel:
                    pend.cancel(); break
                if _now() - last_tok > CC_STALL_SECS:     # silêncio longo demais -> travou
                    pend.cancel(); stalled = True; break
                continue
            try:
                m = pend.result()
            except StopAsyncIteration:
                pend = None; break
            last_tok = _now()
            pend = asyncio.ensure_future(ait.__anext__())   # já agenda a próxima
            if task.cancel:
                pend.cancel(); break
            if isinstance(m, StreamEvent):
                ev = m.event
                if ev.get("type") == "content_block_delta":
                    d = ev.get("delta", {})
                    if d.get("type") == "text_delta":
                        task.last_text += d.get("text", "") or ""
                        await broadcast({"type": "task_delta", "agent_id": ag.id,
                                         "task_id": task.id, "text": task.last_text[-1500:]})
            elif isinstance(m, UserMessage):
                if not task.checkpoint_id and getattr(m, "uuid", None):
                    task.checkpoint_id = m.uuid     # checkpoint pra desfazer
            elif isinstance(m, AssistantMessage):
                parts = []
                for b in m.content:
                    if isinstance(b, TextBlock):
                        parts.append(b.text)
                    else:
                        nm = getattr(b, "name", None)      # ToolUseBlock
                        if nm:
                            await _record_event(ag, task, nm, getattr(b, "input", {}) or {})
                if "".join(parts).strip():
                    final = "".join(parts).strip()
            else:
                c = getattr(m, "total_cost_usd", None)
                if c is None:
                    c = getattr(m, "cost_usd", None)
                if c is not None:
                    task.cost = c
                sid = getattr(m, "session_id", None)
                if sid:
                    ag.session_id = sid     # pra retomar depois (Fase 4)
    except Exception as e:
        if pend:
            pend.cancel()
        task.status = "error"; task.ended_at = _now()
        task.add_log(f"✗ {type(e).__name__}: {e}", "err")
        await broadcast_agent(ag)
        await add_feed("error", ag.project, f"<b>{ag.project}</b>: erro em “{task.title[:50]}”.")
        await maestro_inbox.put({"type": "event", "kind": "error", "project": ag.project})
        return
    if pend:                              # limpa o future pendente (cancelado num break)
        try:
            await asyncio.gather(pend, return_exceptions=True)
        except Exception:
            pass
    if stalled:                           # travou (sem token por muito tempo) -> erro recuperável
        task.status = "error"; task.ended_at = _now()
        task.add_log(f"✗ travou: sem resposta por {CC_STALL_SECS}s (memória/rate limit?)", "err")
        try:
            await client.interrupt()
        except Exception:
            pass
        await broadcast_agent(ag)
        await add_feed("error", ag.project,
                       f"<b>{ag.project}</b>: travou “{task.title[:50]}” — sem resposta por {CC_STALL_SECS}s.")
        await maestro_inbox.put({"type": "event", "kind": "error", "project": ag.project})
        return
    if task.cancel:                       # interrompida por você -> pausada, dá pra reexecutar
        task.status = "paused"; task.ended_at = _now()
        task.add_log("interrompida por você", "warn")
        await broadcast_agent(ag)
        await add_feed("paused", ag.project, f"Você interrompeu “{task.title[:50]}” em <b>{ag.project}</b>.")
        return
    task.last_text = final or task.last_text
    task.status = "done"; task.ended_at = _now()
    task.add_log("✓ concluída", "ok")
    await _refresh_context(ag, client)        # Fase 3: contexto% real (igual ao /context)
    await broadcast_agent(ag)
    await add_feed("done", ag.project, f"<b>{ag.project}</b> concluiu “{task.title[:50]}”.")
    # NÃO fala cru: o evento sobe pro Maestro, que reporta na voz dele (uma só voz).
    if task.last_text:
        await maestro_inbox.put({"type": "event", "kind": "done", "project": ag.project,
                                 "task": task.title, "summary": _spoken_tail(task.last_text)})


async def agent_runner(ag: Agent, resume_sid=None):
    opts = ClaudeAgentOptions(
        # === AGENTE = CLAUDE CODE REAL ===
        system_prompt={"type": "preset", "preset": "claude_code", "append": PANEL_NOTE},
        setting_sources=["user", "project", "local"],   # carrega CLAUDE.md + settings + MCP + skills
        tools={"type": "preset", "preset": "claude_code"},
        allowed_tools=AGENT_AUTO_TOOLS,                  # auto-aprovados (sem prompt); Bash via hook
        model=ag.model, cwd=ag.cwd, effort=ag.effort,
        permission_mode=ag.permission_mode,
        enable_file_checkpointing=True,                  # Fase 2 (rewind)
        extra_args={"replay-user-messages": None},       # recebe UserMessage.uuid (checkpoints)
        resume=resume_sid,                               # Fase 4: retomar sessão anterior
        hooks={"PreToolUse": [HookMatcher(hooks=[make_pre_hook(ag.id, ag.project)])]},
        include_partial_messages=True,
    )
    ag.live = True
    try:
        async with ClaudeSDKClient(options=opts) as client:
            ag.client = client
            while not ag.stopped:
                nxt = None
                if not ag.paused:
                    nxt = next((t for t in ag.tasks if t.status == "queued"), None)
                if nxt is None:
                    ag.wake.clear()
                    await ag.wake.wait()
                    continue
                await run_task(ag, client, nxt)
    except Exception as e:
        cur = ag.current()
        if cur:
            cur.status = "error"; cur.add_log(f"✗ runner: {type(e).__name__}: {e}", "err")
        await broadcast_agent(ag)
    finally:
        ag.live = False
        ag.client = None
        await broadcast_agent(ag)


# ----------------------------------------------------------------- controles (UI + voz do Maestro)
async def _interrupt_current(ag):
    cur = ag.current()
    if cur:
        cur.cancel = True
    if ag.client:
        try:
            await ag.client.interrupt()
        except Exception:
            pass


async def ctl_task(ag, task, action):
    if action == "pause":
        if task.status == "working":
            task.cancel = True
            if ag.client:
                try:
                    await ag.client.interrupt()   # cancela de verdade a execução atual
                except Exception:
                    pass
        elif task.status in ("queued", "waiting"):
            task.status = "paused"; task.add_log("pausada por você", "")
            await add_feed("paused", ag.project, f"Você pausou “{task.title[:50]}” em <b>{ag.project}</b>.")
    elif action == "resume":
        if task.status == "paused":
            task.status = "queued"; task.cancel = False; task.add_log("retomada por você", "")
            ag.wake.set()
            await add_feed("working", ag.project, f"Você retomou “{task.title[:50]}” em <b>{ag.project}</b>.")
    elif action == "rerun":
        task.status = "queued"; task.cancel = False; task.last_text = ""
        task.started_at = None; task.ended_at = None
        task.add_log("reexecutando", "")
        ag.wake.set()
        await add_feed("working", ag.project, f"Você reexecutou “{task.title[:50]}” em <b>{ag.project}</b>.")
    await broadcast_agent(ag)


async def ctl_agent(ag, action):
    if action == "pause":
        ag.paused = True
        await _interrupt_current(ag)
        for t in ag.tasks:
            if t.status == "queued":
                t.status = "paused"
        await add_feed("paused", ag.project, f"Você pausou o agente em <b>{ag.project}</b>.")
    elif action == "resume":
        ag.paused = False
        for t in ag.tasks:
            if t.status == "paused":
                t.status = "queued"
        ag.wake.set()
        await add_feed("working", ag.project, f"Você retomou o agente em <b>{ag.project}</b>.")
    await broadcast_agent(ag)


async def ctl_mode(ag, mode):
    """Troca o modo de permissão de um agente AO VIVO (set_permission_mode do SDK)."""
    mode = norm_pmode(mode)
    ag.permission_mode = mode
    if ag.client:
        try:
            await ag.client.set_permission_mode(mode)
        except Exception:
            pass
    await broadcast_agent(ag)
    await add_feed("working", ag.project, f"Agente do <b>{ag.project}</b> agora em modo {mode}.")


async def ctl_undo(ag, task_id=None):
    """Desfaz (rewind) as mudanças em arquivos de uma tarefa até o checkpoint dela. Fase 2."""
    if task_id:
        tk = ag.find_task(task_id)
    else:                                     # a mais recente com mudanças
        tk = next((t for t in reversed(ag.tasks) if t.checkpoint_id and t.files), None)
    if not tk or not tk.checkpoint_id or not ag.client:
        return 0
    try:
        await ag.client.rewind_files(tk.checkpoint_id)
    except Exception as e:
        await add_feed("error", ag.project, f"Não consegui desfazer em <b>{ag.project}</b>: {type(e).__name__}")
        return 0
    tk.add_log("↩ desfeito (rewind dos arquivos)", "warn")
    tk.files = []
    await broadcast_agent(ag)
    await add_feed("paused", ag.project, f"Você desfez as mudanças de “{tk.title[:50]}” em <b>{ag.project}</b>.")
    return 1


def start_runner(ag, resume_sid=None):
    ag.stopped = False
    ag.runner_task = asyncio.create_task(agent_runner(ag, resume_sid=resume_sid))
    return ag.runner_task


async def restart_agent(ag):
    """Reinicia o runner (pra aplicar novo ESFORÇO, que é fixado na criação do client).
    Retoma a sessão (resume) pra não perder o contexto."""
    if ag.runner_task and not ag.runner_task.done():
        ag.stopped = True
        await _interrupt_current(ag)
        ag.runner_task.cancel()
        try:
            await ag.runner_task
        except (asyncio.CancelledError, Exception):
            pass
    start_runner(ag, resume_sid=ag.session_id)


async def ctl_close(ag):
    """Encerra o agente AGORA: mata o subprocesso claude + MCP (LIBERA RAM), mas mantém o
    agente DORMENTE e retomável (resume) — igual fechar uma aba e poder reabrir depois."""
    ag.stopped = True
    await _interrupt_current(ag)
    if ag.runner_task and not ag.runner_task.done():
        ag.runner_task.cancel()
        try:
            await ag.runner_task          # espera o runner sair -> async with fecha o client -> mata o subprocesso
        except (asyncio.CancelledError, Exception):
            pass
    ag.live = False; ag.client = None
    for t in ag.tasks:                    # o que estava rodando/na fila vira retomável (não 'working' fantasma)
        if t.status in ("working", "waiting", "queued"):
            t.status = "paused"
    await add_feed("paused", ag.project,
                   f"Você encerrou o agente em <b>{ag.project}</b> — RAM liberada, dá pra retomar.")
    await broadcast_agent(ag)
    save_state()


async def ctl_remove(ag):
    """Remove o agente do painel (apaga o card). Se estiver vivo, encerra antes (libera RAM)."""
    if ag.live:
        await ctl_close(ag)
    AGENTS.pop(ag.id, None)
    await broadcast({"type": "agent_removed", "agent_id": ag.id})
    await add_feed("done", ag.project, f"Você removeu um agente de <b>{ag.project}</b> do painel.")
    save_state()


async def ctl_effort(ag, effort):
    ag.effort = norm_effort(effort)
    cur = ag.current()
    if cur:
        cur.status = "paused"; cur.add_log("pausada pra aplicar o novo esforço", "warn")
    await restart_agent(ag)
    await broadcast_agent(ag)
    await add_feed("working", ag.project, f"Esforço do agente de <b>{ag.project}</b> agora: {ag.effort}.")


async def ctl_model(ag, model):
    model = (model or "").strip()
    if not model:
        return
    ag.model = model
    if ag.client:
        try:
            await ag.client.set_model(model)     # set_model é ao vivo (não precisa reiniciar)
        except Exception:
            pass
    await broadcast_agent(ag)
    await add_feed("working", ag.project, f"Modelo do agente de <b>{ag.project}</b> agora: {model}.")


def _norm_proj(s):
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def resolve_project(name):
    if not name:
        return None
    low = _norm_proj(name)
    if not low:
        return None
    norm = {k: _norm_proj(k) for k in PROJECTS}
    # 1) igual ou substring no nome colado ("crm" -> "welcomecrm")
    for k, kk in norm.items():
        if kk == low:
            return k, PROJECTS[k]
    for k, kk in norm.items():
        if low in kk or kk in low:
            return k, PROJECTS[k]
    # 2) overlap de tokens da fala ("welcome crm" -> "welcomecrm")
    toks = [t for t in re.split(r"[^a-z0-9]+", name.lower()) if len(t) >= 3]
    if toks:
        best, score = None, 0
        for k, kk in norm.items():
            hit = sum(1 for t in toks if t in kk)
            if hit > score:
                best, score = k, hit
        if best:
            return best, PROJECTS[best]
    # 3) fallback fuzzy (difflib) sobre os nomes normalizados
    close = difflib.get_close_matches(low, list(norm.values()), n=1, cutoff=0.7)
    if close:
        for k, kk in norm.items():
            if kk == close[0]:
                return k, PROJECTS[k]
    return None


async def do_spawn(project, task, model=None, effort="high", permission_mode="default", label=None):
    pr = resolve_project(project)
    if not pr:
        return f"Não achei o projeto '{project}'. Conhecidos: {', '.join(list(PROJECTS)[:12])}"
    ag = Agent(pr[0], pr[1], model or WORKER_MODEL, effort=effort, permission_mode=permission_mode)
    ag.label = _unique_label(pr[0], label or _derive_label(task))
    ag.add_task(task)
    AGENTS[ag.id] = ag
    start_runner(ag)
    await broadcast_agent(ag)
    tag = f" “{ag.label}”" if ag.label else ""
    await add_feed("working", pr[0], f"Novo agente{tag} em <b>{pr[0]}</b>: “{task[:50]}”.")
    return f"Abri o agente{tag} em {pr[0]} pra: {task}"


def _active_first(matches):
    matches.sort(key=lambda a: a.status() in ("error", "working", "waiting", "queued"), reverse=True)
    return matches


def find_agents(target):
    """Lista de agentes que casam com `target`: id exato → rótulo (exato/substring) → projeto.
    Pode devolver vários (ex.: projeto com mais de um agente) — quem chama desambigua."""
    if not target:
        return []
    if target in AGENTS:
        return [AGENTS[target]]
    t = target.strip().lower()
    # rótulo exato
    exact = [a for a in AGENTS.values() if a.label and a.label.lower() == t]
    if exact:
        return _active_first(exact)
    # projeto (todos do projeto) — tem prioridade sobre substring de rótulo
    pr = resolve_project(target)
    if pr:
        low = pr[0].lower().replace(" ", "")
        proj = [a for a in AGENTS.values() if a.project.lower().replace(" ", "") == low]
        if proj:
            return _active_first(proj)
    # rótulo por substring (último recurso)
    sub = [a for a in AGENTS.values() if a.label and t in a.label.lower()]
    return _active_first(sub)


def find_agent(target):
    """O agente mais relevante (ativo) que casa com `target`, ou None. Use find_agents pra desambiguar."""
    ags = find_agents(target)
    return ags[0] if ags else None


def _ag_tag(ag):
    """Como o Maestro/painel se refere a um agente: 'rótulo no projeto' (ou só o projeto)."""
    return f"“{ag.label}” no {ag.project}" if ag.label else f"do {ag.project}"


def resolve_one(target):
    """(agente, msg_de_desambiguação). Se >1 casar e o alvo não cravar um, devolve (None, pergunta)."""
    ags = find_agents(target)
    if not ags:
        return None, None
    if len(ags) == 1:
        return ags[0], None
    labels = [a.label or "(sem rótulo)" for a in ags]
    proj = ags[0].project
    return None, (f"Tem {len(ags)} agentes no {proj}: {', '.join(labels)} — em qual?")


# ----------------------------------------------------------------- maestro (Opus)
@tool("spawn_agent",
      "Abre um agente dedicado num projeto pra EXECUTAR (ou investigar e reportar) uma tarefa. "
      "Um projeto pode ter VÁRIOS agentes em paralelo — use isto pra abrir um agente NOVO mesmo que "
      "já exista outro no mesmo projeto (cada um trabalha em paralelo). Use também quando o Vitor "
      "PERGUNTAR sobre um projeto: o agente é quem checa git/arquivos e te devolve a resposta — você "
      "nunca checa sozinho. 'label' = apelido curto do que o agente faz (ex.: 'checkout', 'testes') "
      "pra distinguir e referenciar depois; se omitir, eu derivo da tarefa. effort (reasoning): "
      "'low'|'medium'|'high'|'xhigh'|'max' (default high). mode (permissão): 'default' (pede aprovação), "
      "'acceptEdits' (edita livre), 'plan' (planeja e espera aprovação), 'auto' (autônomo vigiado).",
      {"project": str, "task": str, "label": str, "effort": str, "mode": str})
async def spawn_agent_tool(args):
    effort = norm_effort(args.get("effort"))
    mode = norm_pmode(args.get("mode"))
    msg = await do_spawn(args.get("project", ""), args.get("task", ""),
                         effort=effort, permission_mode=mode, label=(args.get("label") or "").strip())
    return {"content": [{"type": "text", "text": msg}]}


@tool("instruct_agent",
      "Dá uma NOVA TAREFA a um agente JÁ ABERTO (entra na fila dele; NÃO abre outro). Use só quando o "
      "Vitor quer continuar NESSE agente. 'target' pode ser id do agente, o RÓTULO dele, ou o projeto. "
      "Se o projeto tiver vários agentes e você não cravar o rótulo, isto devolve a lista pra você "
      "perguntar ao Vitor em qual.",
      {"target": str, "message": str})
async def instruct_agent_tool(args):
    target = (args.get("target") or "").strip()
    message = (args.get("message") or "").strip()
    if not message:
        return {"content": [{"type": "text", "text": "Faltou a tarefa pro agente."}]}
    ag, ask = resolve_one(target)
    if ask:
        return {"content": [{"type": "text", "text": ask + " (ou abra um novo com spawn_agent)"}]}
    if not ag:
        return {"content": [{"type": "text", "text":
                "Não há agente aberto pra esse alvo. Abra um com spawn_agent."}]}
    ag.add_task(message)
    await broadcast_agent(ag)
    await add_feed("working", ag.project, f"Nova tarefa pro agente {_ag_tag(ag)}: “{message[:50]}”.")
    return {"content": [{"type": "text", "text":
            f"Coloquei na fila do agente {_ag_tag(ag)}: {message}"}]}


@tool("control",
      "Controla um agente/tarefa por voz. action pode ser: 'pause'|'resume'|'cancel'|'rerun'; "
      "'close' (ENCERRA o agente e libera a memória — fica retomável); "
      "'approve'|'deny' (aprova/nega um comando ou plano pendente); 'undo' (desfaz as mudanças do "
      "agente); ou um modo de permissão 'default'|'acceptEdits'|'plan'|'auto'|'dontAsk'. "
      "target: id da tarefa, id do agente, o RÓTULO do agente, ou nome do projeto. Se o projeto tiver "
      "vários agentes e você não cravar o rótulo, isto devolve a lista pra você perguntar em qual. "
      "Ex.: 'aprova o do CRM', 'pausa o checkout', 'põe o wedme em modo plan', 'fecha o dos testes'.",
      {"target": str, "action": str})
async def control_tool(args):
    target = (args.get("target") or "").strip()
    action = (args.get("action") or "").strip()
    al = action.lower()
    # aprovar/negar por voz (comando pendente ou plano)
    if al in ("approve", "aprovar", "approved", "deny", "negar", "reject", "recusar", "rejeitar"):
        ok = al in ("approve", "aprovar", "approved")
        target_ids = {a.id for a in find_agents(target)} if target else set()
        resolved = 0
        for apid, (oid, fut, info) in list(PENDING.items()):
            if (oid in target_ids) or (not target and len(PENDING) == 1):
                if not fut.done():
                    fut.set_result(ok)
                    resolved += 1
                PENDING.pop(apid, None)
                await broadcast({"type": "approval_resolved", "approval_id": apid})
        return {"content": [{"type": "text", "text":
                (f"{'Aprovei' if ok else 'Neguei'} pra você." if resolved
                 else "Não achei nada pendente pra aprovar nesse alvo.")}]}
    if al in ("close", "encerra", "encerrar", "fecha", "fechar", "finaliza", "finalizar"):
        ag, ask = resolve_one(target)
        if ask:
            return {"content": [{"type": "text", "text": ask}]}
        if not ag:
            return {"content": [{"type": "text", "text": f"Não achei agente pra '{target}'."}]}
        await ctl_close(ag)
        return {"content": [{"type": "text", "text":
                f"Encerrei o agente {_ag_tag(ag)} e liberei a memória. Dá pra retomar quando quiser."}]}
    if al in ("remove", "remover", "apaga", "apagar", "tira", "tirar"):
        ag, ask = resolve_one(target)
        if ask:
            return {"content": [{"type": "text", "text": ask}]}
        if not ag:
            return {"content": [{"type": "text", "text": f"Não achei agente pra '{target}'."}]}
        await ctl_remove(ag)
        return {"content": [{"type": "text", "text": f"Removi o agente {_ag_tag(ag)} do painel."}]}
    if al == "cancel":
        al = "pause"   # cancelar = pausar (interrompe a execução atual)
    # troca de modo de permissão por voz
    if action in PERMISSION_MODES:
        ag, ask = resolve_one(target)
        if ask:
            return {"content": [{"type": "text", "text": ask}]}
        if not ag:
            return {"content": [{"type": "text", "text": f"Não achei agente pra '{target}'."}]}
        await ctl_mode(ag, action)
        return {"content": [{"type": "text", "text": f"Agente {_ag_tag(ag)} agora em modo {action}."}]}
    if al == "undo":           # desfaz (rewind) — Fase 2
        ag, ask = resolve_one(target)
        if ask:
            return {"content": [{"type": "text", "text": ask}]}
        if not ag:
            return {"content": [{"type": "text", "text": f"Não achei agente pra '{target}'."}]}
        n = await ctl_undo(ag)
        return {"content": [{"type": "text", "text":
                (f"Desfiz as últimas mudanças do agente {_ag_tag(ag)}." if n
                 else "Não havia mudanças pra desfazer.")}]}
    action = al
    if action not in ("pause", "resume", "rerun"):
        return {"content": [{"type": "text", "text": "Ação inválida."}]}
    # tarefa por id?
    for a in AGENTS.values():
        tk = a.find_task(target)
        if tk:
            await ctl_task(a, tk, action)
            return {"content": [{"type": "text", "text":
                    f"{action} na tarefa “{tk.title[:40]}” do agente {_ag_tag(a)}."}]}
    ag, ask = resolve_one(target)
    if ask:
        return {"content": [{"type": "text", "text": ask}]}
    if not ag:
        return {"content": [{"type": "text", "text": f"Não achei agente/tarefa pra '{target}'."}]}
    if action == "rerun":                      # reexecuta a última com erro/pausada
        tk = next((t for t in reversed(ag.tasks) if t.status in ("error", "paused")), None)
        if tk:
            await ctl_task(ag, tk, "rerun")
            return {"content": [{"type": "text", "text": f"Reexecutando “{tk.title[:40]}” no agente {_ag_tag(ag)}."}]}
        return {"content": [{"type": "text", "text": "Nenhuma tarefa parada pra reexecutar."}]}
    await ctl_agent(ag, action)
    return {"content": [{"type": "text", "text": f"{action} no agente {_ag_tag(ag)}."}]}


def _text(c):
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return " ".join(b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text")
    return ""


def active_session_projects():
    """{nome_do_projeto: cwd} das sessões `claude` rodando agora (cwd via lsof)."""
    res = {}
    try:
        pids = subprocess.run(["pgrep", "-x", "claude"], capture_output=True, text=True, timeout=3).stdout.split()
    except Exception:
        pids = []
    home = str(Path.home())
    for pid in pids[:40]:
        try:
            r = subprocess.run(["lsof", "-a", "-d", "cwd", "-p", pid],
                               capture_output=True, text=True, timeout=2).stdout.splitlines()
        except Exception:
            continue
        cwd = r[-1].split()[-1] if len(r) > 1 else ""
        if not cwd or cwd == home:
            continue
        name = os.path.basename(cwd.rstrip("/"))
        if name and name not in res:
            res[name] = cwd
    return res


def latest_transcript_for(cwd):
    # Claude Code codifica o cwd trocando '/' e '.' por '-'
    for enc in (re.sub(r"[/.]", "-", cwd), cwd.replace("/", "-")):
        d = Path.home() / ".claude/projects" / enc
        if d.exists():
            js = sorted(d.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
            if js:
                return str(js[0])
    return None



def session_context_info(path):
    """Extrai modelo, tokens de contexto e cwd da última mensagem assistant no transcript."""
    model = ""
    tokens_used = 0
    cwd_path = ""
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as f:
            head = f.read(4000).decode("utf-8", "ignore")
        for line in head.splitlines():
            try:
                o = json.loads(line)
                if o.get("cwd"):
                    cwd_path = o["cwd"]
                    break
            except Exception:
                pass
        with open(path, "rb") as f:
            if size > 80000:
                f.seek(size - 80000)
            tail = f.read().decode("utf-8", "ignore")
        for line in reversed(tail.splitlines()):
            try:
                o = json.loads(line)
            except Exception:
                continue
            if o.get("type") == "assistant":
                msg = o.get("message") or {}
                if not model:
                    model = msg.get("model", "")
                usage = msg.get("usage", {})
                if usage and not tokens_used:
                    tokens_used = (
                        usage.get("input_tokens", 0) +
                        usage.get("cache_read_input_tokens", 0) +
                        usage.get("cache_creation_input_tokens", 0)
                    )
                if model and tokens_used:
                    break
    except Exception:
        pass
    return model, tokens_used, cwd_path


def build_cockpit():
    """Scans ~/.claude/projects/*/*.jsonl (excl. subagents), retorna sessoes ativas
    (ultimos 20 min) agrupadas por projeto com modelo e %% de contexto usado."""
    import time as _time
    now = _time.time()
    ACTIVE_WINDOW = 20 * 60  # 20 minutos
    projects_dir = Path.home() / ".claude/projects"
    sessions_by_project: dict = {}

    if not projects_dir.exists():
        return {"projects": []}

    for proj_dir in sorted(projects_dir.iterdir()):
        if not proj_dir.is_dir():
            continue
        if "subagent" in proj_dir.name.lower():
            continue
        for jf in proj_dir.glob("*.jsonl"):
            try:
                mtime = jf.stat().st_mtime
            except Exception:
                continue
            if now - mtime > ACTIVE_WINDOW:
                continue
            model, tokens_used, cwd_path = session_context_info(str(jf))
            proj_name = os.path.basename(cwd_path.rstrip("/")) if cwd_path else ""
            if not proj_name:
                proj_name = proj_dir.name.rstrip("-").rsplit("-", 1)[-1] or proj_dir.name
            limit = 200000
            pct = round(tokens_used / limit * 100, 1) if limit else 0
            session = {
                "session_id": jf.stem[:8],
                "model": model or "---",
                "tokens_used": tokens_used,
                "limit": limit,
                "pct": pct,
                "last_activity": mtime,
                # TODO: nivel de thinking (alto/ultra) nao e detectavel com confianca
                # nos transcripts — precisaria inspecionar extended_thinking blocks
                "thinking": "---",
            }
            if proj_name not in sessions_by_project:
                sessions_by_project[proj_name] = {"project": proj_name, "sessions": []}
            sessions_by_project[proj_name]["sessions"].append(session)

    result = []
    for pd in sessions_by_project.values():
        pd["sessions"].sort(key=lambda s: s["last_activity"], reverse=True)
        pd["session_count"] = len(pd["sessions"])
        result.append(pd)
    result.sort(
        key=lambda p: max((s["last_activity"] for s in p["sessions"]), default=0),
        reverse=True,
    )
    return {"projects": result}


def session_meta(path):
    """Extrai tarefa, estado atual e 'tamanho' de um transcript sem ler tudo (head+tail)."""
    try:
        size = os.path.getsize(path)
    except Exception:
        return {}
    task = ""
    try:
        with open(path, "rb") as f:
            head = f.read(60000).decode("utf-8", "ignore")
        for line in head.splitlines():
            try:
                o = json.loads(line)
            except Exception:
                continue
            if o.get("type") == "user":
                c = _text((o.get("message") or {}).get("content"))
                if c and not c.startswith("<") and "tool_result" not in c:
                    task = c[:240]
                    break
    except Exception:
        pass
    last = ""
    try:
        with open(path, "rb") as f:
            if size > 50000:
                f.seek(size - 50000)
            tail = f.read().decode("utf-8", "ignore")
        for line in tail.splitlines():
            try:
                o = json.loads(line)
            except Exception:
                continue
            if o.get("type") == "assistant":
                tx = _text((o.get("message") or {}).get("content"))
                if tx.strip():
                    last = tx[:500]
    except Exception:
        pass
    return {"task": task, "last": last, "size_kb": size // 1024,
            "tokens_est": size // 4, "last_activity": os.path.getmtime(path)}


def build_mission_control():
    items = []
    for name, cwd in active_session_projects().items():
        tp = latest_transcript_for(cwd)
        meta = session_meta(tp) if tp else {}
        items.append({"kind": "sessão ativa", "project": name, "cwd": cwd, **meta})
    for a in AGENTS.values():
        cur = a.current() or (a.tasks[-1] if a.tasks else None)
        items.append({"kind": "agente do painel", "project": a.project,
                      "task": cur.title if cur else "",
                      "last": (cur.last_text if cur else "")[:500], "status": a.status()})
    items.sort(key=lambda x: x.get("last_activity", 0), reverse=True)
    return {"items": items}


def build_unified_cockpit():
    """Cockpit estilo VSCode: projetos com seus agentes dentro. Junta as sessões live REAIS
    do Claude Code (processos `claude` rodando agora, via lsof) e os agentes do Maestro."""
    import time as _time
    now = _time.time()
    by_project: dict = {}

    def ensure(name):
        return by_project.setdefault(name, {"project": name, "agents": []})

    # processos `claude` desses projetos são os PRÓPRIOS agentes do painel — não duplicar
    # como "sessão do VSCode" (eles spawnam um claude no mesmo cwd do projeto).
    agent_projects = {a.project for a in AGENTS.values()
                      if a.status() in ("working", "waiting", "queued", "error")}

    # sessões live = processos `claude` realmente rodando (bounded, com cwd real; home já é pulado)
    for name, cwd in active_session_projects().items():
        if name in agent_projects:
            continue
        tp = latest_transcript_for(cwd)
        if tp:
            model, tokens_used, _ = session_context_info(tp)
            meta = session_meta(tp)
            limit = 1_000_000 if model and "opus-4-8" in model else 200_000
            pct = min(100.0, round(tokens_used / limit * 100, 1))
            la = meta.get("last_activity", now)
            # "rodando" SÓ se o transcript foi escrito agora há pouco (turno em andamento);
            # senão é só uma janela do Claude Code ABERTA e ociosa — não é "executando".
            st = "rodando" if (now - la) < SESSION_ACTIVE_WINDOW else "aberta"
            ensure(name)["agents"].append({
                "kind": "vscode", "session_id": os.path.basename(tp)[:8],
                "model": model or "—", "effort": "—", "pct": pct,
                "tokens_used": tokens_used, "task": meta.get("task", "") or "sessão aberta",
                "last_text": (meta.get("last", "") or "")[:240],
                "status": st, "last_activity": la,
            })
        else:
            ensure(name)["agents"].append({
                "kind": "vscode", "session_id": "—", "model": "—", "effort": "—",
                "pct": None, "task": "sessão aberta", "last_text": "",
                "status": "aberta", "last_activity": now,
            })

    for a in AGENTS.values():
        ensure(a.project)["agents"].append({**a.public(), "pct": None, "last_activity": now})

    result = list(by_project.values())
    for p in result:
        p["agents"].sort(key=lambda x: x.get("last_activity", 0), reverse=True)
    result.sort(key=lambda p: max((x.get("last_activity", 0) for x in p["agents"]), default=0),
                reverse=True)
    return {"projects": result}


def gather_fleet():
    """Visão por projeto: agentes do Maestro (com resultado) + sessões live do VSCode."""
    live = active_session_projects()  # {nome: cwd}
    by_project = {}
    for name in live:
        by_project.setdefault(name, {"live": True, "agents": []})
    for a in AGENTS.values():
        info = by_project.setdefault(a.project, {"live": False, "agents": []})
        info["agents"].append(a)
    return by_project


@tool("fleet_status",
      "O estado da frota AGORA, projeto por projeto: o que cada agente que VOCÊ abriu está "
      "fazendo ou já fez (o resultado deles), e quais projetos têm sessão do VSCode ativa. "
      "Use isto pra responder 'o que tá rolando' e pra saber o que reportar. Lembre: você só "
      "VÊ o que os agentes produziram; pra saber o estado real de um projeto sem agente, abra um.",
      {})
async def fleet_status_tool(args):
    fleet = await asyncio.to_thread(gather_fleet)
    if not fleet:
        return {"content": [{"type": "text", "text":
                "Nenhum agente aberto e nenhuma sessão ativa agora."}]}
    lines = []
    for proj, info in fleet.items():
        for a in info["agents"]:
            head = f"{proj} / {a.label or 'agente'} ({a.id})" + (" (pausado)" if a.paused else "")
            lines.append(head + ":")
            for tk in a.tasks:
                res = (tk.last_text or "").strip().replace("\n", " ")[:160]
                lines.append(f"  · [{tk.status}] {tk.title[:60]} (tarefa {tk.id})"
                             + (f" — {res}" if res else ""))
        if info["live"]:
            tail = "" if info["agents"] else " (sem agente seu; pra saber o que fez, abra um pra checar)"
            lines.append(f"{proj} — tem sessão do VSCode ativa{tail}.")
    return {"content": [{"type": "text", "text": "\n".join(lines)}]}


maestro_server = create_sdk_mcp_server(
    name="maestro", tools=[spawn_agent_tool, instruct_agent_tool, control_tool, fleet_status_tool])
maestro_inbox = asyncio.Queue()
_maestro_resume = asyncio.Event()   # set = rodando; clear = pausado (segura a fila)
_maestro_resume.set()
# config viva do Maestro (modelo + esforço) — trocável pela tela
#   paused: o Maestro para de puxar turnos (fila preservada) até retomar
#   focus:  {project, agent_id, label} fixado por clique na tela; a voz explícita vence
maestro_state = {"model": MAESTRO_MODEL, "effort": norm_effort(MAESTRO_EFFORT),
                 "client": None, "interrupted": False, "sid": None,
                 "paused": False, "focus": None}
_maestro_task = None


def maestro_sysprompt():
    plist = "\n".join(f"- {k}: {v}" for k, v in PROJECTS.items())
    return (
        "Você é o MAESTRO — o condutor pessoal do Vitor por voz. Você NÃO faz o trabalho: "
        "você comanda AGENTES que fazem, e reporta o que eles produziram.\n\n"
        "Um projeto pode ter VÁRIOS agentes trabalhando EM PARALELO — cada um com um RÓTULO curto "
        "(o que ele faz: 'checkout', 'testes', 'pricing'). É assim que você e o Vitor distinguem e "
        "referenciam cada agente. Cada agente tem sua própria FILA DE TAREFAS.\n\n"
        "O QUE VOCÊ FAZ (e SÓ isso):\n"
        "1. ABRIR um agente num projeto pra executar OU investigar algo (spawn_agent) — inclusive um "
        "agente NOVO num projeto que já tem outro, pra rodar em PARALELO. Passe um 'label' curto.\n"
        "2. Dar uma NOVA TAREFA a um agente JÁ aberto (instruct_agent — entra na fila DAQUELE agente). "
        "Use só quando o Vitor quer continuar NESSE agente específico.\n"
        "3. CONTROLAR por voz (control): pausar/retomar/cancelar/reexecutar; APROVAR ou NEGAR um "
        "comando/plano pendente ('aprova o do CRM'); DESFAZER mudanças de um agente ('desfaz o do "
        "wedme'); trocar o MODO do agente ('põe o pricing em modo plan' / 'auto' / 'acceptEdits').\n"
        "4. VER o que os agentes fizeram (fleet_status) e reportar pro Vitor.\n\n"
        "MODOS DE PERMISSÃO (ao abrir/trocar um agente): 'default' pede aprovação pra comando que muta; "
        "'acceptEdits' edita livre; 'plan' faz um plano e ESPERA o Vitor aprovar antes de executar; "
        "'auto' roda sozinho com classificador de segurança. Quando algo espera aprovação ou um plano "
        "fica pronto, AVISE o Vitor por voz (sem ler o comando/plano) e, se ele mandar, aprove/negue.\n\n"
        "No começo de cada fala do Vitor você recebe uma linha [ESTADO AGORA] com o estado vivo da "
        "frota: quais agentes existem, o que cada um está fazendo, e o que está esperando aprovação. "
        "Use isso pra responder e pra resolver as referências dele.\n\n"
        "REGRAS ABSOLUTAS:\n"
        "A. Você NUNCA lê arquivo, roda git, edita ou roda comando — quem mexe no código é SEMPRE o "
        "agente. MAS perguntas de status/visão geral ('o que tá rolando?', 'terminou?', 'tem algo "
        "esperando?', 'quantos agentes abertos?') você RESPONDE NA HORA a partir do [ESTADO AGORA], "
        "SEM abrir agente. Só abra um agente (spawn_agent) quando precisar investigar o código/git/"
        "arquivos de verdade — algo que NÃO está no [ESTADO AGORA] (ex.: 'tem bug no checkout?', 'os "
        "testes passaram?'). E use o [ESTADO AGORA] pra aterrar referências do Vitor: 'aprova o do "
        "CRM', 'continua', 'desfaz o do wedme', 'pausa o pricing'.\n"
        "B. Tarefa nova num projeto que JÁ tem agente: se o Vitor NÃO deixou claro se é pra abrir um "
        "agente novo (paralelo) ou pôr na fila de um que já existe — e QUAL — PERGUNTE numa frase "
        "antes de agir ('abro um agente novo pra isso ou ponho no que já tá rodando os testes?'). Só "
        "use instruct_agent quando ele indicar 'no mesmo', 'continua nesse' ou citar um agente pelo "
        "rótulo. Se ele quer claramente algo independente/em paralelo, use spawn_agent (agente novo). "
        "Se um control/instruct seu voltar pedindo desambiguação (vários agentes no projeto), repasse "
        "a pergunta ao Vitor citando os rótulos.\n"
        "B2. SEMPRE deixe explícito na sua fala DE QUAL agente/projeto você está falando — pelo rótulo "
        "e o projeto ('abri o agente do checkout no CRM', 'o dos testes no wedme terminou', 'pausei o "
        "pricing'). Nunca diga só 'o agente' quando há mais de um no projeto.\n"
        "C. NUNCA use listas, bullets, numeração, markdown, asteriscos ou qualquer formatação — "
        "sua resposta vai direto pro áudio.\n"
        "D. Fale como gente ao telefone: curto, direto, natural. Máximo 1-2 frases por turno. VARIE "
        "o jeito de confirmar — não repita sempre a mesma frase robótica. Nunca diga 'com base em', "
        "'portanto', 'vale notar', 'é importante destacar'. Fale 'beleza, abri um agente pra isso', "
        "'tá rodando', 'terminou e passou'.\n"
        "E. Quando você ABRE ou INSTRUI um agente, responda numa frase só dizendo que disparou — "
        "não fique narrando o que ele vai fazer. O resultado real chega quando o agente terminar.\n"
        "F. Quando chegar um EVENTO INTERNO de que um agente terminou, reporte ao Vitor como um "
        "humano reportaria a outro: o que foi feito e se precisa de mais alguma coisa, em 1-2 frases.\n"
        "G. Sua resposta vira ÁUDIO: NUNCA fale paths, nomes de arquivo, ids, hashes, URLs, códigos "
        "ou números longos — traduza pro humano ('mexeu em três arquivos', não os nomes). Não soletre "
        "nada técnico; descreva em palavras.\n"
        "H. IMAGENS: o Vitor pode anexar uma imagem (vem como '[imagem(ns) anexada(s)... <caminho>]' "
        "no que ele te diz). VOCÊ não abre imagem — quem abre é o agente. Então, ao abrir/instruir o "
        "agente certo (spawn_agent/instruct_agent), INCLUA aquele(s) caminho(s) no texto da tarefa e "
        "peça pra ele abrir com a ferramenta Read. Se não estiver claro qual projeto, pergunte ao "
        "Vitor em uma frase pra qual agente é. Na sua fala, não soletre o caminho — diga 'mandei a "
        "imagem pro agente do CRM olhar', por exemplo.\n\n"
        "EXEMPLOS DE TOM: 'Abri um agente no CRM pra checar isso, já te falo.' "
        "'Terminou no wedme: rodou os testes, passou tudo. Quer mais alguma coisa?' "
        "'Mandei ele continuar e corrigir os lints também.' "
        "'Agora tá rolando o CRM rodando os testes e o wedme esperando você aprovar um comando.' "
        "'Tá tudo parado, nenhum agente aberto no momento.' "
        "'Aprovei o do CRM pra você.'\n\n"
        f"PROJETOS: {plist}"
    )


def _frame_event(item):
    """Transforma um evento interno (ex.: agente terminou) num prompt pro Maestro reportar.
    O Maestro fala HUMANO, sem ler código/comando — só avisa o essencial."""
    kind = item.get("kind")
    if kind == "done":
        return (f'[EVENTO INTERNO — não é o Vitor falando] O agente do projeto "{item["project"]}" '
                f'terminou a tarefa: "{item["task"]}". Resultado que ele te entregou: '
                f'"{item["summary"]}". Reporte ao Vitor AGORA em NO MÁXIMO 1-2 frases faladas, '
                f'como você contaria pra um amigo no telefone: o que foi feito e se precisa de algo. '
                f'NÃO leia paths, nomes de arquivo, ids, hashes, números longos nem jargão técnico — '
                f'traduza pro humano. Não invente além do resultado e não chame ferramenta nenhuma.')
    if kind == "needs_approval":
        return (f'[EVENTO INTERNO] O agente do projeto "{item["project"]}" quer rodar um comando que '
                f'precisa da aprovação do Vitor (aparece um card na tela). Avise o Vitor por voz, em '
                f'UMA frase curta e humana, que tem algo esperando aprovação no {item["project"]} — '
                f'NÃO leia o comando, só avise. Não chame ferramenta nenhuma.')
    if kind == "plan_ready":
        return (f'[EVENTO INTERNO] O agente do projeto "{item["project"]}" terminou de planejar e o '
                f'plano está na tela esperando o Vitor aprovar. Avise por voz, em UMA frase humana, '
                f'que tem um plano pronto pra ele revisar no {item["project"]}. NÃO leia o plano. '
                f'Não chame ferramenta nenhuma.')
    if kind == "error":
        return (f'[EVENTO INTERNO] O agente do projeto "{item["project"]}" deu erro na tarefa. Avise o '
                f'Vitor por voz, UMA frase humana, que deu um problema no {item["project"]} e está na '
                f'tela. NÃO leia stack trace. Não chame ferramenta.')
    return str(item)


_FLEET_ST = {"working": "rodando", "queued": "na fila", "paused": "pausado",
             "error": "deu erro", "done": "terminou", "waiting": "esperando"}


def fleet_snapshot():
    """Linha curta em pt-BR com o estado vivo da frota — injetada a cada turno do Maestro
    pra ele aterrar referências ('aprova o do CRM', 'continua', 'desfaz') e responder
    status sem precisar abrir um agente."""
    parts = []
    for ag in AGENTS.values():
        cur = ag.current()
        task = (cur.title if cur else (ag.tasks[-1].title if ag.tasks else "")).strip()
        if len(task) > 50:
            task = task[:50] + "…"
        s = _FLEET_ST.get(ag.status(), ag.status())
        who = f'{ag.project}/{ag.label}' if ag.label else ag.project
        parts.append(f'{who}: {s}{f" “{task}”" if task else ""}')
    waiting = []
    for _oid, _fut, info in PENDING.values():
        ag = AGENTS.get(_oid)
        proj = ag.project if ag else "?"
        what = "plano" if (info or {}).get("tool") == "ExitPlanMode" else "comando"
        waiting.append(f"{proj} ({what})")
    out = "; ".join(parts) if parts else "nenhum agente aberto"
    if waiting:
        out += ". Esperando sua aprovação: " + ", ".join(waiting)
    return out


async def interrupt_maestro():
    """Para o raciocínio ATUAL do Maestro (você escreveu/falou errado ou mudou de ideia).
    Corta o turno em andamento, cala a fala que estiver saindo e descarta SUAS mensagens
    ainda na fila — eventos da frota (agente terminou etc.) são preservados."""
    maestro_state["interrupted"] = True
    kept = []
    while True:
        try:
            it = maestro_inbox.get_nowait()
        except asyncio.QueueEmpty:
            break
        if isinstance(it, dict) and it.get("type") == "event":   # evento da frota: mantém
            kept.append(it)
    for it in kept:
        maestro_inbox.put_nowait(it)
    daemon_stop()                          # cala a fala em andamento NA HORA
    cl = maestro_state.get("client")
    if cl:
        try:
            await cl.interrupt()
        except Exception:
            pass
    await broadcast({"type": "maestro_status", "thinking": False})


async def pause_maestro():
    """Pausa o Maestro: corta o turno atual e SEGURA a fila (diferente do interrupt, que
    descarta suas mensagens). Tudo que você mandar fica enfileirado; mandar uma nova
    mensagem despausa e ele considera ela (decisão do Vitor)."""
    maestro_state["paused"] = True
    maestro_state["interrupted"] = True
    _maestro_resume.clear()
    daemon_stop()
    cl = maestro_state.get("client")
    if cl:
        try:
            await cl.interrupt()
        except Exception:
            pass
    await broadcast({"type": "maestro_status", "thinking": False})
    await broadcast({"type": "maestro_paused", "paused": True})


async def resume_maestro_queue():
    """Retoma o processamento da fila do Maestro."""
    maestro_state["paused"] = False
    _maestro_resume.set()
    await broadcast({"type": "maestro_paused", "paused": False})


def _focus_line(focus):
    """Linha de contexto pro turno quando há foco fixado na tela (clique). A fala explícita
    do Vitor sempre vence — isto é só o default quando ele não cita ninguém."""
    if not focus:
        return ""
    proj = focus.get("project") or ""
    label = focus.get("label") or ""
    who = f'o agente "{label}" do projeto "{proj}"' if focus.get("agent_id") else f'o projeto "{proj}"'
    return (f'[FOCO FIXADO] O Vitor fixou na tela {who}. Se ele NÃO citar outro projeto/agente '
            f'explicitamente, assuma que o pedido é sobre esse — use instruct_agent NESSE agente '
            f'em vez de abrir outro. Se ele citar outro nome, a fala dele VENCE o foco.')


async def restart_maestro():
    """Reinicia o Maestro com o modelo/esforço atuais (effort só aplica recriando o client)."""
    global _maestro_task
    if _maestro_task:
        _maestro_task.cancel()
        try:
            await _maestro_task
        except (asyncio.CancelledError, Exception):
            pass
    _maestro_task = asyncio.create_task(maestro_runner())


async def maestro_runner():
    # Sobrevive a restart: tenta RETOMAR a sessão anterior (maestro_state["sid"]); se o resume
    # falhar no connect (id velho/inválido), recomeça do zero — sem derrubar o painel.
    sid = maestro_state.get("sid")
    for use_resume in (True, False):
        started = False
        try:
            opts = ClaudeAgentOptions(
                system_prompt=maestro_sysprompt(), model=maestro_state["model"], cwd=str(Path.home()),
                mcp_servers={"maestro": maestro_server}, allowed_tools=MAESTRO_TOOLS,
                effort=maestro_state["effort"],
                permission_mode="default", setting_sources=[],
                hooks={"PreToolUse": [HookMatcher(hooks=[maestro_guard])]},
                include_partial_messages=True,
                resume=(sid if (use_resume and sid) else None),
            )
            async with ClaudeSDKClient(options=opts) as client:
                maestro_state["client"] = client
                started = True
                await broadcast({"type": "maestro_ready"})
                await broadcast({"type": "maestro_config",
                                 "model": maestro_state["model"], "effort": maestro_state["effort"]})
                while True:
                    if maestro_state["paused"]:        # pausado: segura a fila até retomar
                        await broadcast({"type": "maestro_status", "thinking": False})
                        await _maestro_resume.wait()
                    item = await maestro_inbox.get()
                    if item is None:
                        return
                    if isinstance(item, dict) and item.get("type") == "event":
                        origin = "done" if item.get("kind") == "done" else "alert"
                        msg = _frame_event(item)
                        _note = {"done": "terminou", "needs_approval": "precisa de aprovação",
                                 "plan_ready": "plano pronto", "error": "deu erro"}.get(item.get("kind"), "evento")
                        _ev_text = f'{item.get("project", "")}: {_note}'
                        _ets = convo_push("event", _ev_text)
                        await broadcast({"type": "maestro_event", "text": _ev_text, "ts": _ets})
                    else:
                        origin = "user"
                        utext = item.get("text", "") if isinstance(item, dict) else item
                        # Aterra o turno no estado vivo da frota + foco fixado (sem poluir a legenda).
                        snap = fleet_snapshot()
                        foco = _focus_line(maestro_state.get("focus"))
                        parts = []
                        if snap:
                            parts.append(f"[ESTADO AGORA] {snap}")
                        if foco:
                            parts.append(foco)
                        parts.append(f"— Vitor disse: {utext}")
                        msg = "\n".join(parts) if (snap or foco) else utext
                        _uts = convo_push("user", utext)
                        await broadcast({"type": "maestro_user", "text": utext, "ts": _uts})
                    maestro_state["interrupted"] = False
                    await broadcast({"type": "maestro_status", "thinking": True})
                    await client.query(msg)
                    turn_ts = int(_now() * 1000)   # carimbo do turno do Maestro (dia+hora no rail)
                    full = ""
                    last_tok = _now()
                    pend = None
                    try:
                        # Poll de 4s mantendo __anext__ vivo (mesmo padrão dos agentes): interrupt
                        # responde em ≤4s mesmo com stream mudo, e se ficar CC_STALL_SECS sem NENHUM
                        # token finaliza o turno com o que tem — não trava a fila nem deixa o painel
                        # preso em 'Pensando' eterno esperando uma ResultMessage que não vem.
                        ait = client.receive_response().__aiter__()
                        pend = asyncio.ensure_future(ait.__anext__())
                        while True:
                            done, _ = await asyncio.wait({pend}, timeout=4)
                            if not done:
                                if maestro_state["interrupted"]:
                                    pend.cancel(); break
                                if _now() - last_tok > CC_STALL_SECS:   # silêncio longo demais -> travou
                                    pend.cancel(); break
                                continue
                            try:
                                m = pend.result()
                            except StopAsyncIteration:
                                pend = None; break
                            last_tok = _now()
                            pend = asyncio.ensure_future(ait.__anext__())   # já agenda a próxima
                            if maestro_state["interrupted"]:
                                pend.cancel(); break
                            if isinstance(m, StreamEvent):
                                ev = m.event
                                if ev.get("type") == "content_block_delta":
                                    d = ev.get("delta", {})
                                    if d.get("type") == "text_delta":
                                        full += d.get("text", "") or ""
                                        await broadcast({"type": "maestro_delta", "text": full, "ts": turn_ts})
                            elif isinstance(m, AssistantMessage):
                                pass
                            else:
                                _msid = getattr(m, "session_id", None)   # guarda a sessão pra resumir depois
                                if _msid:
                                    maestro_state["sid"] = _msid
                    except Exception:
                        if pend:                # interrupt() pode cortar o stream — não derruba o runner
                            pend.cancel()
                    if pend:                    # limpa o future pendente (cancelado num break)
                        try:
                            await asyncio.gather(pend, return_exceptions=True)
                        except Exception:
                            pass
                    # Você interrompeu (escreveu errado / mudou de ideia): NÃO fala o parcial.
                    if maestro_state["interrupted"]:
                        maestro_state["interrupted"] = False
                        await broadcast({"type": "maestro_done", "text": "⏹ interrompido"})
                        await broadcast({"type": "maestro_status", "thinking": False})
                        continue
                    # Fala o turno INTEIRO de uma vez só: uma síntese contínua, sem picotar
                    # (antes era frase a frase = um /speak por sentença = staccato/gaps).
                    # Chaves de voz: respeita o que o Vitor escolheu falar por origem do turno.
                    should_speak = {"user": STATE["speak_replies"],
                                    "done": STATE["speak_done"],
                                    "alert": STATE["speak_alerts"]}.get(origin, True)
                    if full.strip() and should_speak:
                        speak(full, "maestro")
                    convo_push("done", full.strip(), ts=turn_ts)
                    await broadcast({"type": "maestro_done", "text": full.strip(), "ts": turn_ts})
                    await broadcast({"type": "maestro_status", "thinking": False})
                    _save_throttled()        # persiste o rail + a sessão do maestro
            return
        except Exception:
            if not started and use_resume and sid:
                maestro_state["sid"] = None       # resume falhou no connect -> tenta do zero
                await broadcast({"type": "maestro_event",
                                 "text": "sessão anterior não pôde retomar — começando do zero"})
                continue
            raise


def _stt_prompt():
    """Enviesa o Whisper pro vocabulário certo: nomes EXATOS dos projetos + termos de comando,
    pra ele transcrever 'WelcomeCRM'/'we.wedme' em vez de 'bem-vindo CRM'/'we wed me'."""
    if not PROJECTS:
        return None
    names = ", ".join(PROJECTS.keys())
    return (f"Comando de voz para um assistente de programação. Projetos: {names}. "
            f"Termos: agente, maestro, aprova, nega, plano, modo, pausa, retoma, desfaz, "
            f"effort, lint, deploy, commit, testes.")


def transcribe_audio(raw: bytes) -> str:
    src = tempfile.mktemp(suffix=".webm"); wav = tempfile.mktemp(suffix=".wav")
    with open(src, "wb") as f:
        f.write(raw)
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", src,
                    "-ar", "16000", "-ac", "1", wav], check=False)
    text = ""
    try:
        if os.path.exists(wav) and os.path.getsize(wav) > 1000:
            segs, _ = _stt.transcribe(wav, language="pt", vad_filter=True,
                                      initial_prompt=_stt_prompt())
            text = " ".join(s.text for s in segs).strip()
    finally:
        for f in (src, wav):
            if os.path.exists(f):
                os.remove(f)
    return text


# ----------------------------------------------------------------- app
@asynccontextmanager
async def lifespan(app):
    global _stt
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{PIPER_PORT}/health", timeout=1)
    except Exception:
        subprocess.Popen([str(Path.home() / ".claude/voice/.venv/bin/python"),
                          str(Path.home() / ".claude/voice/tts_server.py")],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # RESPEITA o mute: se você calou (MUTE existe), o painel sobe CALADO (não te surpreende).
    if (Path.home() / ".claude/voice/MUTE").exists():
        STATE["audio"] = False
    PROJECTS.update(discover_projects())
    load_state()                          # Fase 4: agentes anteriores voltam (dormentes)
    from faster_whisper import WhisperModel
    _stt = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
    global _maestro_task
    _maestro_task = asyncio.create_task(maestro_runner())
    yield
    save_state()                          # salva ao encerrar


app = FastAPI(lifespan=lifespan)


@app.get("/")
async def index():
    return HTMLResponse((STATIC / "index.html").read_text())


@app.get("/projects")
async def projects():
    return JSONResponse({"projects": sorted(PROJECTS.keys()), "worker_model": WORKER_MODEL,
                         "maestro_model": maestro_state["model"],
                         "maestro_effort": maestro_state["effort"],
                         "efforts": list(EFFORT_LEVELS)})


@app.post("/maestro/config")
async def maestro_config(req: Request):
    """Troca modelo e/ou esforço do Maestro pela tela (reinicia o Maestro pra aplicar)."""
    body = await req.json()
    model = (body.get("model") or "").strip()
    changed = False
    if model and model != maestro_state["model"]:
        maestro_state["model"] = model
        changed = True
    if body.get("effort"):
        eff = norm_effort(body.get("effort"))
        if eff != maestro_state["effort"]:
            maestro_state["effort"] = eff
            changed = True
    if changed:
        await restart_maestro()
    return JSONResponse({"ok": True, "model": maestro_state["model"], "effort": maestro_state["effort"]})


@app.api_route("/maestro/interrupt", methods=["GET", "POST"])
async def maestro_interrupt_ep():
    """Para o raciocínio atual do Maestro (botão ⏹ da tela / Esc)."""
    await interrupt_maestro()
    return JSONResponse({"ok": True})


@app.api_route("/maestro/pause", methods=["GET", "POST"])
async def maestro_pause_ep():
    """Alterna pausar/retomar o Maestro. Pausado, ele segura a fila (suas mensagens não
    se perdem); mandar uma nova mensagem despausa e ele considera ela."""
    if maestro_state["paused"]:
        await resume_maestro_queue()
    else:
        await pause_maestro()
    return JSONResponse({"ok": True, "paused": maestro_state["paused"]})


@app.post("/maestro/focus")
async def maestro_focus_ep(req: Request):
    """Fixa (ou limpa) o foco em um projeto/agente clicado na tela. Vai como contexto em
    todo comando; a voz explícita do Vitor vence. project vazio = limpar."""
    body = await req.json()
    proj = (body.get("project") or "").strip()
    if proj:
        maestro_state["focus"] = {"project": proj,
                                  "agent_id": body.get("agent_id") or None,
                                  "label": (body.get("label") or "").strip()}
    else:
        maestro_state["focus"] = None
    await broadcast({"type": "maestro_focus", "focus": maestro_state["focus"]})
    return JSONResponse({"ok": True, "focus": maestro_state["focus"]})


@app.get("/missioncontrol")
async def missioncontrol():
    return JSONResponse(await asyncio.to_thread(build_mission_control))


@app.get("/cockpit")
async def cockpit():
    return JSONResponse(await asyncio.to_thread(build_unified_cockpit))


@app.post("/spawn")
async def spawn_agent_ep(req: Request):
    body = await req.json()
    project = (body.get("project") or "").strip()
    task = (body.get("task") or "").strip()
    model = (body.get("model") or "").strip() or WORKER_MODEL
    effort = norm_effort(body.get("effort"))
    mode = norm_pmode(body.get("mode"))
    label = (body.get("label") or "").strip()
    if not project or not task:
        return JSONResponse({"ok": False, "error": "project e task sao obrigatorios"}, status_code=400)
    pr = resolve_project(project)
    if not pr:
        return JSONResponse({"ok": False, "error": f"Projeto '{project}' nao encontrado"}, status_code=404)
    ag = Agent(pr[0], pr[1], model, effort=effort, permission_mode=mode)
    ag.label = _unique_label(pr[0], label or _derive_label(task))
    ag.add_task(task)
    AGENTS[ag.id] = ag
    start_runner(ag)
    await broadcast_agent(ag)
    tag = f" “{ag.label}”" if ag.label else ""
    await add_feed("working", pr[0], f"Novo agente{tag} em <b>{pr[0]}</b>: “{task[:50]}”.")
    return JSONResponse({"ok": True, "agent_id": ag.id, "label": ag.label})


@app.post("/agent/mode")
async def agent_mode(req: Request):
    """Troca o modo de permissão de um agente ao vivo."""
    body = await req.json()
    ag = AGENTS.get(body.get("agent_id"))
    if not ag:
        return JSONResponse({"ok": False, "error": "agente não encontrado"}, status_code=404)
    await ctl_mode(ag, body.get("mode"))
    return JSONResponse({"ok": True, "mode": ag.permission_mode})


@app.post("/agent/label")
async def agent_label(req: Request):
    """Renomeia o rótulo de um agente (distingue vários do mesmo projeto)."""
    body = await req.json()
    ag = AGENTS.get(body.get("agent_id"))
    if not ag:
        return JSONResponse({"ok": False, "error": "agente não encontrado"}, status_code=404)
    ag.label = _unique_label(ag.project, (body.get("label") or "").strip(), exclude_id=ag.id)
    await broadcast_agent(ag)
    save_state()
    return JSONResponse({"ok": True, "label": ag.label})


@app.post("/agent/effort")
async def agent_effort(req: Request):
    """Troca o esforço (reasoning) de um agente — reinicia o runner retomando a sessão."""
    body = await req.json()
    ag = AGENTS.get(body.get("agent_id"))
    if not ag:
        return JSONResponse({"ok": False, "error": "agente não encontrado"}, status_code=404)
    await ctl_effort(ag, body.get("effort"))
    return JSONResponse({"ok": True, "effort": ag.effort})


@app.post("/agent/model")
async def agent_model_ep(req: Request):
    """Troca o modelo de um agente ao vivo (set_model)."""
    body = await req.json()
    ag = AGENTS.get(body.get("agent_id"))
    if not ag:
        return JSONResponse({"ok": False, "error": "agente não encontrado"}, status_code=404)
    await ctl_model(ag, body.get("model"))
    return JSONResponse({"ok": True, "model": ag.model})


@app.post("/agent/undo")
async def agent_undo(req: Request):
    """Desfaz (rewind) as mudanças de uma tarefa/agente."""
    body = await req.json()
    ag = AGENTS.get(body.get("agent_id"))
    if not ag:
        return JSONResponse({"ok": False, "error": "agente não encontrado"}, status_code=404)
    n = await ctl_undo(ag, body.get("task_id"))
    return JSONResponse({"ok": bool(n)})


@app.post("/agent/resume")
async def agent_resume(req: Request):
    """Retoma um agente dormente (reconecta a sessão claude anterior via session_id)."""
    body = await req.json()
    ag = AGENTS.get(body.get("agent_id"))
    if not ag:
        return JSONResponse({"ok": False, "error": "agente não encontrado"}, status_code=404)
    if ag.live:
        return JSONResponse({"ok": True, "already": True})
    ag.stopped = False
    start_runner(ag, resume_sid=ag.session_id)
    await add_feed("working", ag.project, f"Retomei o agente do <b>{ag.project}</b>.")
    return JSONResponse({"ok": True})


@app.post("/command")
async def command(req: Request):
    body = await req.json()
    text = (body.get("text") or "").strip()
    if "autonomy" in body:
        STATE["autonomy"] = body["autonomy"]
    if "audio" in body:
        STATE["audio"] = bool(body["audio"])
        set_mute(not STATE["audio"])
        if not STATE["audio"]:
            daemon_stop()                        # voz OFF cala a fala atual NA HORA
    for k in ("speak_replies", "speak_done", "speak_alerts"):   # chaves de voz
        if k in body:
            STATE[k] = bool(body[k])
    if text:
        if maestro_state["paused"]:              # mandar mensagem despausa (decisão do Vitor)
            await resume_maestro_queue()
        await maestro_inbox.put({"type": "user", "text": text})
        await broadcast({"type": "maestro_queued", "text": text, "qsize": maestro_inbox.qsize()})
    return JSONResponse({"ok": True})


@app.api_route("/hush", methods=["GET", "POST"])
async def hush():
    """BOTÃO DE PÂNICO: cala TUDO na hora (fala atual + fila), muta e desliga a voz."""
    STATE["audio"] = False
    set_mute(True)
    daemon_stop()
    await broadcast({"type": "audio", "audio": False})
    return JSONResponse({"ok": True})


@app.api_route("/unhush", methods=["GET", "POST"])
async def unhush():
    """Religa a voz."""
    STATE["audio"] = True
    set_mute(False)
    await broadcast({"type": "audio", "audio": True})
    return JSONResponse({"ok": True})


@app.post("/voice")
async def voice(audio: UploadFile = File(...)):
    raw = await audio.read()
    text = await asyncio.to_thread(transcribe_audio, raw)
    if text:
        if maestro_state["paused"]:
            await resume_maestro_queue()
        await maestro_inbox.put({"type": "user", "text": text})
        await broadcast({"type": "maestro_queued", "text": text, "qsize": maestro_inbox.qsize()})
    return JSONResponse({"text": text})


@app.post("/stt")
async def stt(audio: UploadFile = File(...)):
    raw = await audio.read()
    return JSONResponse({"text": await asyncio.to_thread(transcribe_audio, raw)})


@app.post("/upload")
async def upload(file: UploadFile = File(...)):
    """Recebe uma imagem colada/arrastada no painel, salva num arquivo e devolve o
    caminho absoluto. O front injeta esse caminho na tarefa; o agente (Claude Code
    real) abre a imagem com a ferramenta Read — igual à extensão do VS Code."""
    UPLOADS.mkdir(exist_ok=True)
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
        ext = ".png"
    name = uuid.uuid4().hex[:12] + ext
    dest = UPLOADS / name
    dest.write_bytes(await file.read())
    return JSONResponse({"ok": True, "path": str(dest), "name": file.filename or name})


@app.post("/approve")
async def approve(req: Request):
    body = await req.json()
    entry = PENDING.pop(body.get("approval_id"), None)
    if entry and not entry[1].done():
        entry[1].set_result(bool(body.get("ok")))
    return JSONResponse({"ok": True})


@app.post("/reply")
async def reply(req: Request):
    """Adiciona uma NOVA TAREFA à fila de um agente (instruir pelo card)."""
    body = await req.json()
    ag = AGENTS.get(body.get("agent_id"))
    text = (body.get("text") or "").strip()
    if ag and text:
        ag.add_task(text)
        await broadcast_agent(ag)
        await add_feed("working", ag.project, f"Nova tarefa pro agente de <b>{ag.project}</b>: “{text[:50]}”.")
        return JSONResponse({"ok": True})
    return JSONResponse({"ok": False})


@app.post("/task")
async def add_task_ep(req: Request):
    """Adiciona uma tarefa a um agente existente."""
    body = await req.json()
    ag = AGENTS.get(body.get("agent_id"))
    title = (body.get("title") or "").strip()
    if not ag or not title:
        return JSONResponse({"ok": False, "error": "agent_id e title obrigatórios"}, status_code=400)
    ag.add_task(title)
    await broadcast_agent(ag)
    await add_feed("working", ag.project, f"Nova tarefa pro agente de <b>{ag.project}</b>: “{title[:50]}”.")
    return JSONResponse({"ok": True})


@app.post("/task/control")
async def task_control(req: Request):
    """Pausa/retoma/reexecuta uma tarefa. action: pause|resume|rerun."""
    body = await req.json()
    ag = AGENTS.get(body.get("agent_id"))
    action = (body.get("action") or "").strip().lower()
    if not ag:
        return JSONResponse({"ok": False, "error": "agente não encontrado"}, status_code=404)
    tk = ag.find_task(body.get("task_id"))
    if not tk:
        return JSONResponse({"ok": False, "error": "tarefa não encontrada"}, status_code=404)
    if action not in ("pause", "resume", "rerun"):
        return JSONResponse({"ok": False, "error": "ação inválida"}, status_code=400)
    await ctl_task(ag, tk, action)
    return JSONResponse({"ok": True})


@app.post("/agent/control")
async def agent_control(req: Request):
    """Pausa/retoma um agente inteiro. action: pause|resume."""
    body = await req.json()
    ag = AGENTS.get(body.get("agent_id"))
    action = (body.get("action") or "").strip().lower()
    if not ag:
        return JSONResponse({"ok": False, "error": "agente não encontrado"}, status_code=404)
    if action == "close":                 # encerra e libera RAM (fica retomável)
        await ctl_close(ag)
        return JSONResponse({"ok": True})
    if action == "remove":                # apaga o card do painel (encerra antes, se vivo)
        await ctl_remove(ag)
        return JSONResponse({"ok": True})
    if action not in ("pause", "resume"):
        return JSONResponse({"ok": False, "error": "ação inválida"}, status_code=400)
    await ctl_agent(ag, action)
    return JSONResponse({"ok": True})


@app.post("/say")
async def say_ep(req: Request):
    """Re-fala um texto (botão 'repetir' do Maestro)."""
    body = await req.json()
    text = (body.get("text") or "").strip()
    if text:
        speak(text, "maestro")
    return JSONResponse({"ok": True})


@app.get("/feed")
async def feed_ep():
    return JSONResponse({"feed": FEED})


@app.websocket("/ws")
async def ws(websocket: WebSocket):
    await websocket.accept()
    WS.add(websocket)
    await websocket.send_text(json.dumps({
        "type": "snapshot",
        "agents": [a.public() for a in AGENTS.values()],
        "approvals": [{"id": k, "agent_id": v[0], "project": (AGENTS[v[0]].project if v[0] in AGENTS else "maestro"),
                       "tool": v[2]["tool"], "preview": v[2]["preview"], "since": v[2].get("since")} for k, v in PENDING.items()],
        "feed": FEED,
        "maestro_convo": MAESTRO_CONVO,
        "maestro_model": maestro_state["model"], "maestro_effort": maestro_state["effort"],
        "maestro_paused": maestro_state["paused"], "maestro_focus": maestro_state["focus"],
        "speak_replies": STATE["speak_replies"], "speak_done": STATE["speak_done"],
        "speak_alerts": STATE["speak_alerts"],
        "autonomy": STATE["autonomy"], "audio": STATE["audio"]}))
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        WS.discard(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("CC_PORT", "8770")), log_level="warning")
