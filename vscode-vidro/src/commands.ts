// Registro de todos os comandos da extensão.
import * as vscode from "vscode";
import { Backend } from "./backend";
import { Store } from "./store";
import { Voice } from "./voice";
import { AgentNode } from "./agentsTree";
import { AgentPublic } from "./types";

interface Deps {
  backend: Backend;
  store: Store;
  voice: Voice;
  out: vscode.OutputChannel;
  startBackend: () => Promise<void>;
  stopBackend: () => void;
}

export function registerCommands(ctx: vscode.ExtensionContext, d: Deps) {
  const reg = (id: string, fn: (...a: any[]) => any) =>
    ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg("vidro.mic", () => d.voice.captureAndSend());

  reg("vidro.talk", async () => {
    const text = await vscode.window.showInputBox({ prompt: "Falar com o maestro", placeHolder: "ex.: abre um agente no WelcomeCRM e arruma o login" });
    if (text?.trim()) await safe(d, () => d.backend.command(text.trim()));
  });

  async function spawnFlow(preProject?: string) {
    let project = preProject;
    if (!project) {
      let projects: string[] = d.store.allProjects;
      if (!projects.length) {
        try {
          projects = (await d.backend.projects()).projects || [];
        } catch { /* ignore */ }
      }
      project = projects.length
        ? await vscode.window.showQuickPick(projects, { placeHolder: "Projeto do novo agente" })
        : await vscode.window.showInputBox({ prompt: "Nome/caminho do projeto" });
    }
    if (!project) return;
    const task = await vscode.window.showInputBox({ prompt: `Primeira tarefa do agente em ${project}` });
    if (!task?.trim()) return;
    const mode = await vscode.window.showQuickPick(
      ["default", "acceptEdits", "plan", "dontAsk"],
      { placeHolder: "Modo de permissão (default = confirma mutações)" }
    );
    await safe(d, async () => {
      const r = await d.backend.spawn(project!, task.trim(), { mode: mode || "default" });
      if (r?.ok) vscode.window.setStatusBarMessage(`$(rocket) Agente criado em ${project}`, 4000);
      else vscode.window.showErrorMessage(`Vidro: ${r?.error || "falha ao criar agente"}`);
    });
  }
  reg("vidro.newAgent", () => spawnFlow());
  reg("vidro.newAgentInProject", (arg?: any) => spawnFlow(typeof arg === "string" ? arg : arg?.project));

  reg("vidro.reopenAgent", async (node?: AgentNode) => {
    const ag = await resolveAgent(d.store, node);
    if (!ag) return;
    await safe(d, () => d.backend.resumeAgent(ag.id));
    const next = await vscode.window.showInputBox({
      prompt: `Reabrir "${ag.label || ag.project}" — próxima tarefa? (deixe vazio só pra reativar)`,
    });
    if (next?.trim()) await safe(d, () => d.backend.addTask(ag.id, next.trim()));
    vscode.window.setStatusBarMessage(`$(debug-start) Reaberto: ${ag.label || ag.project}`, 4000);
  });

  reg("vidro.refresh", async () => {
    await d.startBackend();
  });
  reg("vidro.startBackend", () => d.startBackend());
  reg("vidro.stopBackend", () => d.stopBackend());

  reg("vidro.toggleAudio", () => safe(d, () => d.backend.setAudio(!d.store.audio)));
  reg("vidro.hush", () => safe(d, () => d.backend.hush()));

  reg("vidro.sendToAgent", async (node?: AgentNode) => {
    const ag = await resolveAgent(d.store, node);
    if (!ag) return;
    const text = await vscode.window.showInputBox({ prompt: `Falar direto com ${ag.label || ag.project}` });
    if (text?.trim()) await safe(d, () => d.backend.addTask(ag.id, text.trim()));
  });

  reg("vidro.openInTerminal", async (node?: AgentNode) => {
    const ag = await resolveAgent(d.store, node);
    if (!ag) return;
    openResumeTerminal(ag);
  });

  reg("vidro.takeover", async (node?: AgentNode) => {
    const ag = await resolveAgent(d.store, node);
    if (!ag) return;
    const yes = await vscode.window.showWarningMessage(
      `Assumir "${ag.label || ag.project}"? O maestro para o piloto automático dele (só um motorista por vez) e abre a sessão no terminal pra você dirigir.`,
      { modal: true },
      "Assumir"
    );
    if (yes !== "Assumir") return;
    await safe(d, () => d.backend.agentControl(ag.id, "close")); // encerra o auto-drive (fica retomável)
    openResumeTerminal(ag);
  });

  reg("vidro.handBack", async (node?: AgentNode) => {
    const ag = await resolveAgent(d.store, node);
    if (!ag) return;
    await safe(d, () => d.backend.resumeAgent(ag.id));
    vscode.window.setStatusBarMessage(`$(debug-continue) Maestro retomou ${ag.label || ag.project}`, 4000);
  });

  reg("vidro.undo", async (node?: AgentNode) => {
    const ag = await resolveAgent(d.store, node);
    if (!ag) return;
    const yes = await vscode.window.showWarningMessage(
      `Desfazer as mudanças de arquivo da última tarefa de "${ag.label || ag.project}"?`,
      { modal: true },
      "Desfazer"
    );
    if (yes !== "Desfazer") return;
    await safe(d, () => d.backend.undo(ag.id));
  });

  reg("vidro.openChanges", async (node?: AgentNode) => {
    const ag = await resolveAgent(d.store, node);
    if (!ag) return;
    const files = collectFiles(ag);
    if (!files.length) {
      vscode.window.showInformationMessage("Vidro: nenhum arquivo alterado registrado nas tarefas deste agente.");
      return;
    }
    for (const f of files.slice(0, 8)) {
      const uri = vscode.Uri.file(f);
      try {
        await vscode.commands.executeCommand("git.openChange", uri);
      } catch {
        try {
          await vscode.window.showTextDocument(uri, { preview: false });
        } catch { /* ignore */ }
      }
    }
  });

  reg("vidro.setMode", async (node?: AgentNode) => {
    const ag = await resolveAgent(d.store, node);
    if (!ag) return;
    const mode = await vscode.window.showQuickPick(["default", "acceptEdits", "plan", "auto", "dontAsk"], {
      placeHolder: `Modo de permissão (atual: ${ag.permission_mode})`,
    });
    if (mode) await safe(d, () => d.backend.setMode(ag.id, mode));
  });

  reg("vidro.pauseAgent", async (node?: AgentNode) => {
    const ag = await resolveAgent(d.store, node);
    if (ag) await safe(d, () => d.backend.agentControl(ag.id, "pause"));
  });
  reg("vidro.resumeAgent", async (node?: AgentNode) => {
    const ag = await resolveAgent(d.store, node);
    if (ag) await safe(d, () => d.backend.agentControl(ag.id, "resume"));
  });
  reg("vidro.closeAgent", async (node?: AgentNode) => {
    const ag = await resolveAgent(d.store, node);
    if (!ag) return;
    const yes = await vscode.window.showWarningMessage(
      `Encerrar "${ag.label || ag.project}"? (fica retomável depois)`,
      { modal: true },
      "Encerrar"
    );
    if (yes === "Encerrar") await safe(d, () => d.backend.agentControl(ag.id, "close"));
  });
}

function openResumeTerminal(ag: AgentPublic) {
  const term = vscode.window.createTerminal({ name: `claude · ${ag.label || ag.project}`, cwd: ag.cwd });
  term.show();
  const cmd = ag.session_id ? `claude --resume ${ag.session_id}` : "claude --continue";
  term.sendText(cmd);
}

function collectFiles(ag: AgentPublic): string[] {
  const set = new Set<string>();
  for (const t of ag.tasks || []) for (const f of t.files || []) set.add(f);
  return [...set];
}

async function resolveAgent(store: Store, node?: AgentNode): Promise<AgentPublic | undefined> {
  if (node && node.agent) return node.agent;
  const agents = store.agentList();
  if (!agents.length) {
    vscode.window.showInformationMessage("Vidro: nenhum agente ativo.");
    return undefined;
  }
  if (agents.length === 1) return agents[0];
  const pick = await vscode.window.showQuickPick(
    agents.map((a) => ({ label: a.label || a.project, description: `${a.project} · ${a.status}`, a })),
    { placeHolder: "Qual agente?" }
  );
  return pick?.a;
}

async function safe(d: Deps, fn: () => Promise<unknown> | unknown) {
  try {
    await fn();
  } catch (e) {
    vscode.window.showErrorMessage(`Vidro: ${(e as Error).message}`);
    d.out.appendLine(`[erro] ${(e as Error).stack || (e as Error).message}`);
  }
}
