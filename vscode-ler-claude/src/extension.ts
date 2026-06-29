// Ler Claude — botão na barra de status que lê em voz alta um resumo curto da
// última resposta do Claude Code na sessão atual. Acha o transcript da sessão e
// manda um POST /announce pro daemon de voz (~/.claude/voice), que resume via
// Haiku e fala via edge-tts. Sem subprocess Python aqui: só achar o arquivo + HTTP.
//
// Enquanto fala, o botão vira ⏸ Pausar / ▶ Continuar (estado lido por polling do
// /status do daemon). Cmd+Alt+P = pausar/continuar; Cmd+Alt+. = parar de vez.
import * as vscode from "vscode";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";

const HOST = "127.0.0.1";
const POLL_MS = 900; // monitora o daemon o tempo todo, pra refletir até o auto-speak

let status: vscode.StatusBarItem;      // "🔊 Resumo" — sempre visível; toca a conversa do começo
let playState: vscode.StatusBarItem;   // transiente: resumindo… / Pausar / Continuar
let clearBtn: vscode.StatusBarItem;    // transiente: "⏹ Limpar" — zera o atual + a fila
let autoStatus: vscode.StatusBarItem;  // toggle: pré-geração automática (silenciosa) por projeto
let speakStatus: vscode.StatusBarItem; // toggle: falar sozinho ao terminar, por projeto
let out: vscode.OutputChannel;
let uiTimer: NodeJS.Timeout | undefined;
let polling = false;       // evita ticks sobrepostos
let generating = false;    // pedimos um resumo e esperamos o áudio começar
let generatingSince = 0;
// Última aba de conversa do Claude que esteve em foco. Usada quando o botão é
// apertado com um arquivo de código em foco (aí lembramos a conversa que ele via).
let lastClaudeTabLabel: string | undefined;

export function activate(ctx: vscode.ExtensionContext) {
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 52);
  playState = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 51);
  clearBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
  autoStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 49);
  speakStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 48);
  out = vscode.window.createOutputChannel("Ler Claude");
  // "🔊 Resumo" é fixo: sempre toca a conversa em foco DO COMEÇO (mesmo durante o auto-speak).
  status.text = "$(unmute) Resumo";
  status.command = "claudeReadAloud.speak";
  status.tooltip = "Ouvir o resumo da conversa em foco, do começo (Cmd+Alt+L)";
  status.show();
  // "⏹ Limpar" zera o áudio atual + tudo que está na fila (útil no auto-speak).
  clearBtn.text = "$(stop-circle) Limpar";
  clearBtn.command = "claudeReadAloud.stop";
  clearBtn.tooltip = "Zerar: descarta o áudio atual e toda a fila. As novas que chegarem tocam normalmente.";
  setIdle();
  refreshAutoStatus();
  autoStatus.show();
  speakStatus.show();
  rememberActiveTab();
  startUiLoop();
  ctx.subscriptions.push(
    status,
    playState,
    clearBtn,
    autoStatus,
    speakStatus,
    out,
    vscode.commands.registerCommand("claudeReadAloud.speak", speak),
    vscode.commands.registerCommand("claudeReadAloud.pause", pause),
    vscode.commands.registerCommand("claudeReadAloud.resume", resume),
    vscode.commands.registerCommand("claudeReadAloud.toggle", toggle),
    vscode.commands.registerCommand("claudeReadAloud.stop", stop),
    vscode.commands.registerCommand("claudeReadAloud.toggleAutoPrep", toggleAutoPrep),
    vscode.commands.registerCommand("claudeReadAloud.toggleAutoSpeak", toggleAutoSpeak),
    // Acompanha qual conversa do Claude está em foco (troca de aba ou de grupo).
    vscode.window.tabGroups.onDidChangeTabs(rememberActiveTab),
    vscode.window.tabGroups.onDidChangeTabGroups(rememberActiveTab)
  );
}

export function deactivate() {
  if (uiTimer) clearInterval(uiTimer);
}

function cfg() {
  const c = vscode.workspace.getConfiguration("claudeReadAloud");
  return {
    port: c.get<number>("port", 8765),
    voicectl: expandHome(c.get<string>("voicectlPath", "~/.claude/voice/voicectl.sh")),
  };
}

// ---- estados visuais do botão ----

// Mostra quantas falas estão esperando na fila (acumulam no auto-speak se você pausa).
function queueSuffix(qsize?: number): string {
  return qsize && qsize > 0 ? ` (+${qsize} na fila)` : "";
}

function setIdle() {
  playState.hide();
  clearBtn.hide();
}

function setSummarizing() {
  playState.text = "$(loading~spin) resumindo…";
  playState.command = "claudeReadAloud.stop";
  playState.tooltip = "Resumindo… clique para cancelar";
  playState.show();
  clearBtn.hide();
}

function setPlaying(qsize?: number) {
  playState.text = "$(debug-pause) Pausar" + queueSuffix(qsize);
  playState.command = "claudeReadAloud.pause";
  playState.tooltip = "Falando… clique para pausar (Cmd+Alt+P). 🔊 Resumo toca do começo; ⏹ Limpar zera a fila.";
  playState.show();
  clearBtn.show();
}

function setPaused(qsize?: number) {
  playState.text = "$(play) Continuar" + queueSuffix(qsize);
  playState.command = "claudeReadAloud.resume";
  playState.tooltip =
    "Pausado — Continuar retoma de onde parou. ⏹ Limpar zera o atual e a fila; 🔊 Resumo toca a conversa do começo.";
  playState.show();
  clearBtn.show();
}

// ---- comandos ----

async function speak() {
  const { port, voicectl } = cfg();
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    vscode.window.showWarningMessage("Ler Claude: abra uma pasta de projeto primeiro.");
    return;
  }

  setSummarizing();
  generating = true;
  generatingSince = Date.now();
  try {
    const transcript = await resolveTranscript(folder);
    if (!transcript) {
      generating = false;
      setIdle();
      vscode.window.showWarningMessage("Ler Claude: nenhuma sessão do Claude Code encontrada para esta pasta.");
      return;
    }

    await ensureDaemon(port, voicectl);
    // Recomeçar DO COMEÇO: corta o que estiver tocando/pausado (e a fila) antes de reproduzir.
    try {
      await postJson(port, "/stop", {});
    } catch {
      /* nada tocando */
    }
    await postJsonResp(port, "/speak_session", {
      event: "Stop",
      transcript_path: transcript,
      cwd: folder,
      session_id: path.basename(transcript, ".jsonl"),
    });
    // O monitor contínuo reflete a UI: toca na hora se for cache; senão mantém o spinner.
  } catch (e: any) {
    generating = false;
    setIdle();
    vscode.window.showErrorMessage(`Ler Claude falhou: ${e?.message || e}`);
  }
}

async function pause() {
  const { port } = cfg();
  setPaused(); // feedback imediato; o polling confirma
  try {
    await postJson(port, "/pause", {});
  } catch {
    /* nada tocando = nada a pausar */
  }
}

async function resume() {
  const { port } = cfg();
  setPlaying();
  try {
    await postJson(port, "/resume", {});
  } catch {
    /* ignora */
  }
}

async function toggle() {
  const { port } = cfg();
  const st = await getStatus(port);
  if (st?.paused) return resume();
  if (st?.playing) return pause();
  // nada tocando: dispara uma nova leitura
  return speak();
}

async function stop() {
  const { port } = cfg();
  generating = false;
  setIdle();
  try {
    await postJson(port, "/stop", {});
  } catch {
    /* daemon fora do ar = nada tocando */
  }
}

// ---- monitor contínuo do estado da fala ----
// Roda sempre (não só após clicar), pra o controle Pausar/Continuar aparecer também
// quando o auto-speak começa a falar sozinho.

function startUiLoop() {
  if (uiTimer) return;
  uiTimer = setInterval(pollOnce, POLL_MS);
}

async function pollOnce() {
  if (polling) return;
  polling = true;
  try {
    const { port } = cfg();
    const st = await getStatus(port);
    if (!st) return; // daemon indisponível: mantém o estado atual
    if (st.playing && !st.paused) {
      generating = false;
      setPlaying(st.qsize);
    } else if (st.paused) {
      generating = false;
      setPaused(st.qsize);
    } else {
      // daemon ocioso: ou ainda estamos gerando (spinner) ou tudo parado
      if (generating && Date.now() - generatingSince < 15000) setSummarizing();
      else {
        generating = false;
        setIdle();
      }
    }
  } finally {
    polling = false;
  }
}

// ---- escolher o transcript pela aba/conversa em foco ----

// A extensão oficial do Claude abre cada conversa como uma aba (webview/custom)
// cujo título é o `ai-title` gravado no transcript. Não há API que exponha o
// session_id da aba, então casamos pelo TÍTULO: aba em foco -> aiTitle -> .jsonl.
function isLikelyClaudeTab(tab?: vscode.Tab): boolean {
  const inp: any = tab?.input;
  if (!inp) return false;
  const vt = typeof inp.viewType === "string" ? inp.viewType : "";
  if (/claude|anthropic/i.test(vt)) return true;
  // Qualquer webview/custom é candidato; o casamento por título valida depois.
  return inp instanceof vscode.TabInputWebview || inp instanceof vscode.TabInputCustom;
}

function rememberActiveTab() {
  const t = vscode.window.tabGroups.activeTabGroup?.activeTab;
  if (isLikelyClaudeTab(t) && t?.label?.trim()) lastClaudeTabLabel = t.label;
}

async function resolveTranscript(cwd: string): Promise<string | undefined> {
  const active = vscode.window.tabGroups.activeTabGroup?.activeTab;
  const activeIsClaude = isLikelyClaudeTab(active);
  // Só usamos o título da ABA ATIVA (não a última vista — que fica velha e lia errado).
  const targets = activeIsClaude && active?.label && active.label.trim().length >= 3
    ? [active.label]
    : [];

  const dir = path.join(os.homedir(), ".claude", "projects", cwd.replace(/[/.]/g, "-"));
  const candidates = listJsonl(dir).sort((a, b) => b.mtime - a.mtime).slice(0, 25);

  let chosen: string | undefined;
  let how = "";
  // 1) Aba do Claude em foco, casada por título (mais preciso quando detectável).
  if (candidates.length && targets.length) {
    const m = matchByTitle(candidates.map((c) => c.file), targets);
    if (m) {
      chosen = m.file;
      how = `título "${m.title}" ≈ aba "${m.target}"`;
    }
  }
  // 2) Senão: a conversa onde VOCÊ digitou por último (ignora os agentes de fundo).
  if (!chosen && candidates.length) {
    const u = mostRecentUserPrompt(candidates.map((c) => c.file));
    if (u) {
      chosen = u.file;
      how = `último prompt seu (${u.ts})`;
    }
  }
  // 3) Último recurso: mais recente por mtime.
  if (!chosen) {
    chosen = await findTranscript(cwd);
    how = how || "fallback (mtime)";
  }

  const line =
    `[resolve] ${new Date().toISOString()} aba="${active?.label ?? "(nenhuma)"}" ` +
    `claudeTab=${activeIsClaude} input=${tabInputKind(active)} ` +
    `lastClaudeTab="${lastClaudeTabLabel ?? "-"}" | escolha=${chosen ? path.basename(chosen) : "(nenhuma)"} | via ${how}`;
  out.appendLine(line);
  try {
    fs.appendFileSync(path.join(os.homedir(), ".claude", "voice", "lerclaude-resolve.log"), line + "\n");
  } catch {
    /* diagnóstico best-effort */
  }
  return chosen;
}

// Descreve o tipo da aba ativa (pra diagnosticar se a conversa do Claude é aba de
// editor, webview, ou se nem aparece — caso esteja na barra lateral).
function tabInputKind(tab?: vscode.Tab): string {
  const inp: any = tab?.input;
  if (!inp) return "none";
  if (inp instanceof vscode.TabInputText) return "text:" + path.basename(inp.uri?.fsPath ?? "");
  if (inp instanceof vscode.TabInputWebview) return "webview:" + (inp.viewType ?? "");
  if (inp instanceof vscode.TabInputCustom) return "custom:" + (inp.viewType ?? "");
  if (inp instanceof vscode.TabInputNotebook) return "notebook";
  return "other:" + (inp.viewType ?? inp.constructor?.name ?? "?");
}

// Entre os candidatos, escolhe a conversa cujo ÚLTIMO prompt genuíno do usuário é o
// mais recente — ou seja, a que você está realmente conduzindo agora.
function mostRecentUserPrompt(files: string[]): { file: string; ts: string } | undefined {
  let best: { file: string; ts: string } | undefined;
  for (const file of files) {
    const ts = lastUserPromptTime(file);
    if (ts && (!best || ts > best.ts)) best = { file, ts };
  }
  return best;
}

// Timestamp do último prompt REAL do usuário no arquivo (lê até 1MB do fim). Ignora
// tool_result, mensagens de sistema (<...>) e meta — só conta o que VOCÊ digitou.
function lastUserPromptTime(file: string): string | undefined {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const size = fs.fstatSync(fd).size;
      const len = Math.min(1048576, size);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      const lines = buf.toString("utf8").split("\n");
      let ts: string | undefined;
      for (const ln of lines) {
        const s = ln.trim();
        if (!s) continue;
        let o: any;
        try {
          o = JSON.parse(s);
        } catch {
          continue; // linha cortada no começo do chunk
        }
        if (o.type !== "user" || !o.timestamp) continue;
        const c = o.message?.content;
        let txt = "";
        if (typeof c === "string") txt = c;
        else if (Array.isArray(c)) txt = c.filter((b: any) => b && b.type === "text").map((b: any) => b.text || "").join(" ");
        else continue;
        if (!txt.trim() || txt.startsWith("<") || /tool_result/.test(JSON.stringify(c))) continue;
        ts = o.timestamp; // mantém o último (mais recente) do arquivo
      }
      return ts;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

// Casa o título-alvo (da aba) com o aiTitle de cada transcript. Igualdade ganha de
// substring; em empate vence o mais recente (candidatos já vêm ordenados por mtime).
function matchByTitle(
  files: string[],
  targets: string[]
): { file: string; title: string; target: string } | undefined {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[…]+$/, "").replace(/\.\.\.$/, "").trim();
  const nTargets = targets.map((t) => ({ raw: t, n: norm(t) })).filter((t) => t.n.length >= 3);
  let best: { file: string; title: string; target: string; score: number } | undefined;
  for (const file of files) {
    const title = tailAiTitle(file);
    if (!title) continue;
    const nt = norm(title);
    if (!nt) continue;
    for (const tg of nTargets) {
      let score = 0;
      if (nt === tg.n) score = 1000;
      else if (nt.includes(tg.n) || tg.n.includes(nt)) score = Math.min(nt.length, tg.n.length);
      if (score > 0 && (!best || score > best.score)) {
        best = { file, title, target: tg.raw, score };
      }
    }
  }
  return best ? { file: best.file, title: best.title, target: best.target } : undefined;
}

// Lê o fim do arquivo (128KB) e devolve o último `aiTitle` (o título atual da aba).
function tailAiTitle(file: string): string | undefined {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const size = fs.fstatSync(fd).size;
      const len = Math.min(131072, size);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      const lines = buf.toString("utf8").split("\n").filter((l) => l.trim());
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const o = JSON.parse(lines[i]);
          if (o.type === "ai-title" && typeof o.aiTitle === "string" && o.aiTitle.trim()) {
            return o.aiTitle.trim();
          }
        } catch {
          // linha cortada no começo do chunk; tenta a próxima
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // ignora
  }
  return undefined;
}

// ---- achar o transcript da sessão atual ----

async function findTranscript(cwd: string): Promise<string | undefined> {
  const projects = path.join(os.homedir(), ".claude", "projects");
  // Caminho feliz: diretório codificado (Claude Code troca "/" e "." por "-").
  const encoded = cwd.replace(/[/.]/g, "-");
  const fromDirect = newestJsonl(path.join(projects, encoded));
  if (fromDirect) return fromDirect;

  // Fallback: varre todos os projetos e casa pelo campo .cwd da última linha.
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(projects).map((d) => path.join(projects, d));
  } catch {
    return undefined;
  }
  const candidates = dirs.flatMap(listJsonl).sort((a, b) => b.mtime - a.mtime);
  for (const c of candidates) {
    if (tailCwd(c.file) === cwd) return c.file;
  }
  return undefined;
}

function listJsonl(dir: string): Array<{ file: string; mtime: number }> {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => {
        const file = path.join(dir, f);
        return { file, mtime: fs.statSync(file).mtimeMs };
      });
  } catch {
    return [];
  }
}

function newestJsonl(dir: string): string | undefined {
  return listJsonl(dir).sort((a, b) => b.mtime - a.mtime)[0]?.file;
}

// Lê o último ~64KB do arquivo e devolve o campo .cwd da última linha JSON.
function tailCwd(file: string): string | undefined {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const size = fs.fstatSync(fd).size;
      const len = Math.min(65536, size);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      const lines = buf.toString("utf8").split("\n").filter((l) => l.trim());
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const o = JSON.parse(lines[i]);
          if (o.cwd) return o.cwd;
        } catch {
          // linha cortada no começo do chunk; tenta a próxima
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // ignora
  }
  return undefined;
}

// ---- toggles de automação por projeto (pré-gerar silencioso vs falar sozinho) ----
// O hook global ~/.claude/hooks/voice-prepare.sh lê estas duas listas: autospeak.list
// (fala sozinho via /announce) tem prioridade sobre autoprepare.list (silencioso, /prepare).
// Os dois modos são mutuamente exclusivos no botão: ligar um desliga o outro.

const PREP_LIST = "autoprepare.list";
const SPEAK_LIST = "autospeak.list";

function voiceFile(name: string): string {
  return path.join(os.homedir(), ".claude", "voice", name);
}

function listEntries(name: string): string[] {
  try {
    return fs.readFileSync(voiceFile(name), "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function setMembership(name: string, folder: string, on: boolean) {
  const e = listEntries(name);
  const i = e.indexOf(folder);
  if (on && i < 0) e.push(folder);
  else if (!on && i >= 0) e.splice(i, 1);
  else return;
  fs.mkdirSync(path.dirname(voiceFile(name)), { recursive: true });
  fs.writeFileSync(voiceFile(name), e.length ? e.join("\n") + "\n" : "");
}

function refreshAutoStatus() {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const prepOn = !!folder && listEntries(PREP_LIST).includes(folder);
  const speakOn = !!folder && listEntries(SPEAK_LIST).includes(folder);

  autoStatus.text = `$(broadcast) Auto: ${prepOn ? "ON" : "OFF"}`;
  autoStatus.tooltip = !folder
    ? "Pré-gerar resumo: abra uma pasta de projeto"
    : prepOn
    ? "Pré-gerando o resumo quando um agente termina — o botão toca na hora (clique p/ desligar)"
    : "Clique para PRÉ-GERAR o resumo quando um agente terminar (silencioso; toca no clique)";
  autoStatus.command = "claudeReadAloud.toggleAutoPrep";

  speakStatus.text = `$(megaphone) Falar: ${speakOn ? "ON" : "OFF"}`;
  speakStatus.tooltip = !folder
    ? "Falar sozinho: abra uma pasta de projeto"
    : speakOn
    ? "Falando sozinho assim que um agente termina (clique p/ desligar)"
    : "Clique para FALAR sozinho assim que um agente terminar, já dizendo o que foi feito";
  speakStatus.command = "claudeReadAloud.toggleAutoSpeak";
}

async function toggleAutoPrep() {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    vscode.window.showWarningMessage("Ler Claude: abra uma pasta de projeto primeiro.");
    return;
  }
  const on = !listEntries(PREP_LIST).includes(folder);
  try {
    setMembership(PREP_LIST, folder, on);
    if (on) setMembership(SPEAK_LIST, folder, false); // modos exclusivos
  } catch (e: any) {
    vscode.window.showErrorMessage(`Ler Claude: não consegui salvar (${e?.message || e}).`);
    return;
  }
  refreshAutoStatus();
  vscode.window.showInformationMessage(
    on
      ? "Auto-resumo (silencioso) LIGADO: pré-gero o áudio quando um agente terminar aqui — o botão toca na hora."
      : "Auto-resumo desligado neste projeto."
  );
}

async function toggleAutoSpeak() {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    vscode.window.showWarningMessage("Ler Claude: abra uma pasta de projeto primeiro.");
    return;
  }
  const on = !listEntries(SPEAK_LIST).includes(folder);
  try {
    setMembership(SPEAK_LIST, folder, on);
    if (on) setMembership(PREP_LIST, folder, false); // modos exclusivos
  } catch (e: any) {
    vscode.window.showErrorMessage(`Ler Claude: não consegui salvar (${e?.message || e}).`);
    return;
  }
  refreshAutoStatus();
  vscode.window.showInformationMessage(
    on
      ? "Falar sozinho LIGADO: vou falar assim que um agente terminar aqui, já dizendo o que foi feito."
      : "Falar sozinho desligado neste projeto."
  );
}

// ---- daemon de voz ----

async function ensureDaemon(port: number, voicectl: string) {
  if (await healthOk(port)) return;
  if (fs.existsSync(voicectl)) {
    spawn("bash", [voicectl, "start"], { detached: true, stdio: "ignore" }).unref();
  }
  for (let i = 0; i < 8; i++) {
    await delay(300);
    if (await healthOk(port)) return;
  }
}

function healthOk(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request({ host: HOST, port, path: "/health", method: "GET", timeout: 800 }, (res) => {
      res.resume();
      resolve((res.statusCode || 500) < 400);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

interface PlayStatus {
  playing: boolean;
  paused: boolean;
  queued: boolean;
  qsize?: number;
}

function getStatus(port: number): Promise<PlayStatus | undefined> {
  return new Promise((resolve) => {
    const req = http.request({ host: HOST, port, path: "/status", method: "GET", timeout: 800 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          resolve(undefined);
        }
      });
    });
    req.on("error", () => resolve(undefined));
    req.on("timeout", () => {
      req.destroy();
      resolve(undefined);
    });
    req.end();
  });
}

function postJson(port: number, p: string, body: unknown): Promise<void> {
  const data = Buffer.from(JSON.stringify(body ?? {}), "utf8");
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: HOST,
        port,
        path: p,
        method: "POST",
        timeout: 5000,
        headers: { "Content-Type": "application/json", "Content-Length": String(data.length) },
      },
      (res) => {
        res.resume();
        res.on("end", () => {
          if ((res.statusCode || 500) >= 400) reject(new Error(`HTTP ${res.statusCode} ${p}`));
          else resolve();
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.write(data);
    req.end();
  });
}

// Igual ao postJson, mas resolve com o JSON da resposta (ex.: {cached:true} do /speak_session).
function postJsonResp(port: number, p: string, body: unknown): Promise<any> {
  const data = Buffer.from(JSON.stringify(body ?? {}), "utf8");
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: HOST,
        port,
        path: p,
        method: "POST",
        timeout: 5000,
        headers: { "Content-Type": "application/json", "Content-Length": String(data.length) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          if ((res.statusCode || 500) >= 400) return reject(new Error(`HTTP ${res.statusCode} ${p}`));
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
          } catch {
            resolve({});
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.write(data);
    req.end();
  });
}

function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
