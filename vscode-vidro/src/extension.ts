// Vidro — extensão VSCode: maestro de voz + vários Claude Code reais, à mostra no editor.
// Front-end nativo do motor "Mission Control" (command_center.py).
import * as vscode from "vscode";
import { Backend } from "./backend";
import { Store } from "./store";
import { WsClient } from "./wsclient";
import { AgentsTree } from "./agentsTree";
import { MaestroView } from "./maestroView";
import { Voice } from "./voice";
import { registerCommands } from "./commands";
import { isUp } from "./http";

let ws: WsClient | undefined;
let backend: Backend;
let weStartedBackend = false;

export async function activate(ctx: vscode.ExtensionContext) {
  const out = vscode.window.createOutputChannel("Vidro");
  ctx.subscriptions.push(out);
  out.appendLine("Vidro ativando…");

  const store = new Store();
  backend = new Backend(out, ctx.extensionPath);

  // Sidebar (projetos → agentes → tarefas)
  const tree = new AgentsTree(store);
  ctx.subscriptions.push(vscode.window.registerTreeDataProvider("vidro.agents", tree));

  // Voz + rail do maestro (referências cruzadas resolvidas por closures)
  let maestro: MaestroView;
  const voice = new Voice(backend, out, (on) => maestro?.flashListening(on));
  maestro = new MaestroView(ctx, store, backend, () => voice.captureAndSend());
  ctx.subscriptions.push(vscode.window.registerWebviewViewProvider(MaestroView.viewType, maestro));

  // Status bar
  const sb = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  sb.command = "vidro.mic";
  sb.tooltip = "Vidro: clique para falar com o maestro";
  ctx.subscriptions.push(sb);
  const setSb = (connected: boolean) => {
    sb.text = connected ? "$(unmute) Vidro" : "$(circle-slash) Vidro offline";
    sb.color = connected ? undefined : new vscode.ThemeColor("charts.red");
    sb.show();
  };
  setSb(false);

  // Comandos
  registerCommands(ctx, {
    backend,
    store,
    voice,
    out,
    startBackend: () => connect(out, backend, store, setSb),
    stopBackend: () => {
      ws?.dispose();
      ws = undefined;
      if (weStartedBackend) backend.stop();
      store.setConnected(false);
      setSb(false);
    },
  });

  ctx.subscriptions.push({ dispose: () => ws?.dispose() });

  // Sobe/conecta
  await connect(out, backend, store, setSb);
}

async function connect(
  out: vscode.OutputChannel,
  backend: Backend,
  store: Store,
  setSb: (c: boolean) => void
) {
  const wasUp = await backendWasUp(backend);
  const ok = await backend.ensureRunning();
  weStartedBackend = ok && !wasUp;
  if (!ok) {
    store.setConnected(false);
    setSb(false);
    return;
  }
  if (ws) ws.dispose();
  ws = new WsClient(backend.port, out);
  ws.onMessage((m) => store.apply(m));
  ws.onStatus((connected) => {
    store.setConnected(connected);
    setSb(connected);
    if (connected) {
      backend
        .projects()
        .then((p) => store.setProjects(p.projects || []))
        .catch(() => { /* ignore */ });
    }
  });
  ws.start();
}

async function backendWasUp(backend: Backend): Promise<boolean> {
  try {
    return await isUp(backend.port);
  } catch {
    return false;
  }
}

export function deactivate() {
  ws?.dispose();
  if (weStartedBackend) backend?.stop();
}
