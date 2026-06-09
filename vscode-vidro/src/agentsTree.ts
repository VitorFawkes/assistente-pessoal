// Sidebar nativa: TODOS os projetos → agentes (vivos e dormentes) → tarefas, com status ao vivo.
import * as vscode from "vscode";
import { Store } from "./store";
import { AgentPublic, TaskPublic } from "./types";

type Node = ProjectNode | AgentNode | TaskNode | EmptyNode;

export class ProjectNode extends vscode.TreeItem {
  constructor(public readonly project: string, count: number) {
    super(project, count > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
    this.description = count === 0 ? "sem agente · clique p/ abrir" : count === 1 ? "1 agente · clique p/ +" : `${count} agentes · clique p/ +`;
    this.contextValue = "project";
    this.iconPath = new vscode.ThemeIcon(count > 0 ? "folder-active" : "folder");
    this.tooltip = `Clique para abrir um novo agente em ${project} (use a setinha para expandir)`;
    this.command = { command: "vidro.newAgentInProject", title: "Novo agente", arguments: [project] };
  }
}

export class EmptyNode extends vscode.TreeItem {
  constructor(public readonly project: string) {
    super("Abrir agente aqui…", vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon("add");
    this.contextValue = "empty";
    this.command = { command: "vidro.newAgentInProject", title: "Novo agente", arguments: [project] };
  }
}

export class AgentNode extends vscode.TreeItem {
  constructor(public readonly agent: AgentPublic, waiting: boolean) {
    super(agent.label || agent.project, vscode.TreeItemCollapsibleState.Expanded);
    const dormant = agent.live === false;
    const st = dormant ? "dormente" : waiting ? "waiting" : agent.status;
    this.description = `${st} · ${shortModel(agent.model)} · ${agent.permission_mode}`;
    this.contextValue = dormant ? "agentDormant" : "agent";
    this.id = "agent:" + agent.id;
    this.iconPath = dormant ? new vscode.ThemeIcon("debug-disconnect") : statusIcon(st);
    this.command = { command: "vidro.focusAgent", title: "Focar agente", arguments: [agent] };
    this.tooltip = new vscode.MarkdownString(
      `**${agent.label || agent.project}** — ${agent.project}\n\n` +
        `status: ${st}${dormant ? " (clique em ↻ Reabrir pra continuar)" : ""}\n\n` +
        `model: ${agent.model} · effort: ${agent.effort} · modo: ${agent.permission_mode}\n\n` +
        `sessão: ${agent.session_id || "—"}\n\ncwd: ${agent.cwd || "—"}`
    );
  }
}

export class TaskNode extends vscode.TreeItem {
  constructor(public readonly agent: AgentPublic, public readonly task: TaskPublic) {
    super(task.title, vscode.TreeItemCollapsibleState.None);
    this.description = task.status + (task.elapsed ? ` · ${task.elapsed}` : "") + (task.can_undo ? " · ↩︎" : "");
    this.contextValue = "task";
    this.iconPath = statusIcon(task.status);
    const files = (task.files || []).join("\n");
    this.tooltip = new vscode.MarkdownString(
      `**${task.title}**\n\nstatus: ${task.status}\n\n${task.last_text ? task.last_text.slice(-600) : ""}` +
        (files ? `\n\n**arquivos:**\n${files}` : "")
    );
  }
}

export class AgentsTree implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private readonly store: Store) {
    store.onAgents(() => this._onDidChange.fire());
  }

  getTreeItem(el: Node): vscode.TreeItem {
    return el;
  }

  getChildren(el?: Node): Node[] {
    if (!el) {
      const byProj = this.store.projectsMap();
      const names = new Set<string>([...this.store.allProjects, ...byProj.keys()]);
      return [...names]
        .sort((a, b) => a.localeCompare(b))
        .map((proj) => new ProjectNode(proj, (byProj.get(proj) || []).length));
    }
    if (el instanceof ProjectNode) {
      const agents = (this.store.projectsMap().get(el.project) || []).sort((a, b) =>
        (a.label || "").localeCompare(b.label || "")
      );
      if (!agents.length) return [new EmptyNode(el.project)];
      return agents.map((a) => new AgentNode(a, this.agentWaiting(a.id)));
    }
    if (el instanceof AgentNode) {
      return (el.agent.tasks || []).map((t) => new TaskNode(el.agent, t));
    }
    return [];
  }

  private agentWaiting(agentId: string): boolean {
    for (const ap of this.store.approvals.values()) if (ap.agent_id === agentId) return true;
    return false;
  }
}

function statusIcon(status: string): vscode.ThemeIcon {
  switch (status) {
    case "working":
      return new vscode.ThemeIcon("sync~spin", new vscode.ThemeColor("charts.blue"));
    case "waiting":
      return new vscode.ThemeIcon("warning", new vscode.ThemeColor("charts.yellow"));
    case "done":
      return new vscode.ThemeIcon("pass", new vscode.ThemeColor("charts.green"));
    case "error":
      return new vscode.ThemeIcon("error", new vscode.ThemeColor("charts.red"));
    case "paused":
      return new vscode.ThemeIcon("debug-pause");
    default:
      return new vscode.ThemeIcon("clock");
  }
}

function shortModel(m: string): string {
  if (!m) return "—";
  if (m.includes("opus")) return "opus";
  if (m.includes("sonnet")) return "sonnet";
  if (m.includes("haiku")) return "haiku";
  return m;
}
