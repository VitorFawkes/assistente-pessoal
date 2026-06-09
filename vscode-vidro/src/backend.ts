// Lifecycle do motor (Mission Control) + cliente tipado das rotas HTTP.
import * as vscode from "vscode";
import * as cp from "child_process";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { getJson, postJson, postFile, isUp } from "./http";

function expandHome(p: string): string {
  if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
  return p;
}

export class Backend {
  private proc: cp.ChildProcess | undefined;
  readonly output: vscode.OutputChannel;
  private readonly extensionPath: string;

  constructor(out: vscode.OutputChannel, extensionPath: string) {
    this.output = out;
    this.extensionPath = extensionPath;
  }

  get port(): number {
    return vscode.workspace.getConfiguration("vidro").get<number>("port", 8781);
  }

  // Vazio = motor EMBUTIDO (engine/), independente do Mission Control.
  private get ccPath(): string {
    const cfg = (vscode.workspace.getConfiguration("vidro").get<string>("commandCenterPath", "") || "").trim();
    if (cfg) return expandHome(cfg);
    return path.join(this.extensionPath, "engine");
  }

  async ensureRunning(): Promise<boolean> {
    if (await isUp(this.port)) {
      this.output.appendLine(`[backend] já no ar em :${this.port} — conectando.`);
      return true;
    }
    const auto = vscode.workspace.getConfiguration("vidro").get<boolean>("autoStartBackend", true);
    if (!auto) {
      this.output.appendLine(`[backend] fora do ar e autoStart desligado.`);
      return false;
    }
    return this.start();
  }

  async start(): Promise<boolean> {
    if (await isUp(this.port)) return true;
    const runSh = path.join(this.ccPath, "run.sh");
    if (!fs.existsSync(runSh)) {
      vscode.window.showErrorMessage(`Vidro: run.sh não encontrado em ${this.ccPath}. Configure "vidro.commandCenterPath".`);
      return false;
    }
    this.output.appendLine(`[backend] iniciando headless: ${runSh}`);
    const env = { ...process.env, CC_HEADLESS: "1", CC_PORT: String(this.port) };
    delete (env as Record<string, string>).ANTHROPIC_API_KEY; // herda o login do Claude Code
    this.proc = cp.spawn("/bin/bash", [runSh], { cwd: this.ccPath, env, detached: false });
    this.proc.stdout?.on("data", (d) => this.output.append(`[motor] ${d}`));
    this.proc.stderr?.on("data", (d) => this.output.append(`[motor] ${d}`));
    this.proc.on("exit", (code) => this.output.appendLine(`[backend] motor saiu (code ${code}).`));
    // espera subir (até ~30s)
    for (let i = 0; i < 60; i++) {
      await delay(500);
      if (await isUp(this.port)) {
        this.output.appendLine(`[backend] no ar em :${this.port}.`);
        return true;
      }
    }
    vscode.window.showErrorMessage("Vidro: o motor não subiu a tempo. Veja o output 'Vidro'.");
    return false;
  }

  stop() {
    if (this.proc && !this.proc.killed) {
      this.output.appendLine("[backend] parando motor que iniciamos.");
      try {
        this.proc.kill("SIGTERM");
      } catch { /* ignore */ }
    }
    this.proc = undefined;
  }

  // ---- rotas ----
  projects() {
    return getJson<{ projects: string[]; worker_model: string; maestro_model: string; maestro_effort: string; efforts: string[] }>(
      this.port,
      "/projects"
    );
  }
  command(text: string, extra: Record<string, unknown> = {}) {
    return postJson(this.port, "/command", { text, ...extra });
  }
  spawn(project: string, task: string, opts: { effort?: string; mode?: string; label?: string } = {}) {
    return postJson<{ ok: boolean; agent_id?: string; label?: string; error?: string }>(this.port, "/spawn", {
      project,
      task,
      ...opts,
    });
  }
  addTask(agent_id: string, title: string) {
    return postJson(this.port, "/task", { agent_id, title });
  }
  approve(approval_id: string, ok: boolean) {
    return postJson(this.port, "/approve", { approval_id, ok });
  }
  undo(agent_id: string) {
    return postJson(this.port, "/agent/undo", { agent_id });
  }
  resumeAgent(agent_id: string) {
    return postJson(this.port, "/agent/resume", { agent_id });
  }
  agentControl(agent_id: string, action: "pause" | "resume" | "close" | "remove") {
    return postJson(this.port, "/agent/control", { agent_id, action });
  }
  setMode(agent_id: string, mode: string) {
    return postJson(this.port, "/agent/mode", { agent_id, mode });
  }
  say(text: string) {
    return postJson(this.port, "/say", { text });
  }
  setAudio(on: boolean) {
    return postJson(this.port, "/command", { audio: on });
  }
  hush() {
    return postJson(this.port, "/hush", {});
  }
  sendVoiceFile(wavPath: string) {
    return postFile<{ text: string }>(this.port, "/voice", "audio", wavPath);
  }
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
