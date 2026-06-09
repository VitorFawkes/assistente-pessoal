// Estado em memória do painel, alimentado pelas mensagens do WS.
import * as vscode from "vscode";
import { AgentPublic, Approval, ConvoTurn, FeedItem, Snapshot, WsMessage } from "./types";

export class Store {
  agents = new Map<string, AgentPublic>();
  allProjects: string[] = []; // lista completa de projetos do motor (mesmo sem agente)
  feed: FeedItem[] = [];
  approvals = new Map<string, Approval>();
  convo: ConvoTurn[] = [];
  audio = true;
  connected = false;

  setProjects(list: string[]) {
    this.allProjects = (list || []).slice().sort((a, b) => a.localeCompare(b));
    this._onAgents.fire();
  }

  private readonly _onAgents = new vscode.EventEmitter<void>();
  private readonly _onMaestro = new vscode.EventEmitter<void>(); // convo/feed/approvals/audio/connected
  readonly onAgents = this._onAgents.event;
  readonly onMaestro = this._onMaestro.event;

  setConnected(v: boolean) {
    this.connected = v;
    if (!v) {
      // motor caiu: limpamos o estado vivo, mas mantemos a conversa por contexto
      this.agents.clear();
      this.approvals.clear();
    }
    this._onAgents.fire();
    this._onMaestro.fire();
  }

  apply(msg: WsMessage) {
    switch (msg.type) {
      case "snapshot": {
        const s = msg as Snapshot;
        this.agents.clear();
        for (const a of s.agents) this.agents.set(a.id, a);
        this.feed = s.feed || [];
        this.approvals.clear();
        for (const ap of s.approvals || []) this.approvals.set(ap.id, ap);
        this.convo = s.maestro_convo || [];
        this.audio = !!s.audio;
        this._onAgents.fire();
        this._onMaestro.fire();
        break;
      }
      case "agent_update": {
        const a = (msg as any).agent as AgentPublic;
        this.agents.set(a.id, a);
        this._onAgents.fire();
        break;
      }
      case "feed": {
        this.feed.unshift((msg as any).item);
        this.feed = this.feed.slice(0, 60);
        this._onMaestro.fire();
        break;
      }
      case "approval": {
        const ap = (msg as any).approval as Approval;
        this.approvals.set(ap.id, ap);
        this._onMaestro.fire();
        this._onAgents.fire();
        break;
      }
      case "approval_resolved": {
        const id = (msg as any).approval_id as string;
        this.approvals.delete(id);
        this._onMaestro.fire();
        this._onAgents.fire();
        break;
      }
      case "maestro_user": {
        this.convo.push({ kind: "user", text: (msg as any).text || "", ts: Date.now() });
        this._onMaestro.fire();
        break;
      }
      case "maestro_queued": {
        this.convo.push({ kind: "user", text: (msg as any).text || "", ts: Date.now() });
        this._onMaestro.fire();
        break;
      }
      case "maestro_delta": {
        const delta = (msg as any).delta ?? (msg as any).text ?? "";
        const last = this.convo[this.convo.length - 1];
        if (last && last.kind === "maestro" && (last as any)._streaming) {
          last.text += delta;
        } else {
          this.convo.push({ kind: "maestro", text: delta, ts: Date.now(), ...({ _streaming: true } as any) });
        }
        this._onMaestro.fire();
        break;
      }
      case "maestro_done": {
        const text = (msg as any).text || "";
        const last = this.convo[this.convo.length - 1];
        if (last && last.kind === "maestro" && (last as any)._streaming) {
          if (text) last.text = text;
          delete (last as any)._streaming;
        } else if (text) {
          this.convo.push({ kind: "maestro", text, ts: Date.now() });
        }
        this._onMaestro.fire();
        break;
      }
      case "maestro_event": {
        const text = (msg as any).text;
        if (text) {
          this.convo.push({ kind: "event", text, ts: Date.now() });
          this._onMaestro.fire();
        }
        break;
      }
      case "audio": {
        this.audio = !!(msg as any).audio;
        this._onMaestro.fire();
        break;
      }
      default:
        break;
    }
  }

  agentList(): AgentPublic[] {
    return [...this.agents.values()];
  }

  projectsMap(): Map<string, AgentPublic[]> {
    const m = new Map<string, AgentPublic[]>();
    for (const a of this.agents.values()) {
      const arr = m.get(a.project) || [];
      arr.push(a);
      m.set(a.project, arr);
    }
    return m;
  }
}
