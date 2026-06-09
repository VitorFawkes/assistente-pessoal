// Tipos espelhando os payloads do motor (command_center.py).

export interface TaskPublic {
  id: string;
  title: string;
  status: "queued" | "working" | "waiting" | "paused" | "done" | "error";
  log: Array<{ t?: string; text: string; level?: string }> | string[];
  last_text: string;
  elapsed?: string;
  events: Array<{ t?: string; tool?: string; brief?: string }>;
  files: string[];
  cost?: number | null;
  can_undo?: boolean;
}

export interface AgentPublic {
  id: string;
  project: string;
  label: string;
  kind?: string;
  model: string;
  effort: string;
  permission_mode: string;
  paused: boolean;
  live: boolean;
  context?: { pct?: number; tokens?: number; max?: number } | null;
  cost?: number | null;
  status: "queued" | "working" | "waiting" | "paused" | "done" | "error";
  tasks: TaskPublic[];
  cwd?: string;
  session_id?: string | null;
}

export interface FeedItem {
  id: string;
  at: number;
  kind: "working" | "done" | "error" | "paused" | "waiting" | "maestro";
  proj: string;
  text: string;
}

export interface Approval {
  id: string;
  agent_id: string;
  project: string;
  tool: string;
  preview: string;
}

export interface ConvoTurn {
  kind: string; // "user" | "maestro" | "event" | ...
  text: string;
  ts?: number;
}

export interface Snapshot {
  type: "snapshot";
  agents: AgentPublic[];
  approvals: Approval[];
  feed: FeedItem[];
  maestro_convo: ConvoTurn[];
  maestro_model: string;
  maestro_effort: string;
  maestro_paused: boolean;
  maestro_focus: unknown;
  audio: boolean;
  autonomy?: unknown;
}

export type WsMessage =
  | Snapshot
  | { type: "agent_update"; agent: AgentPublic }
  | { type: "feed"; item: FeedItem }
  | { type: "approval"; approval: Approval }
  | { type: "approval_resolved"; approval_id: string }
  | { type: "plan_ready"; id: string; agent_id: string; project: string; plan: string }
  | { type: "maestro_user"; text: string }
  | { type: "maestro_delta"; delta?: string; text?: string }
  | { type: "maestro_done"; text: string }
  | { type: "maestro_status"; [k: string]: unknown }
  | { type: "maestro_queued"; text: string; qsize: number }
  | { type: "maestro_event"; text?: string; [k: string]: unknown }
  | { type: "audio"; audio: boolean }
  | { type: string; [k: string]: unknown };
