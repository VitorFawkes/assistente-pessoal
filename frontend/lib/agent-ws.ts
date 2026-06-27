"use client";

// Cliente WebSocket da ponte do assistente (roda no Mac do Vitor).
// Reconecta sozinho com backoff. A página só consome onEvent/onStatus.

export type AgentEvent =
  | { type: "auth_ok" }
  | { type: "auth_error" }
  | { type: "message_start" }
  | { type: "content_delta"; text: string }
  | { type: "tool_call"; tool: string; input?: Record<string, unknown> }
  | { type: "message_end"; text?: string; session_id?: string }
  | { type: "error"; text: string }
  | { type: "cleared" }
  | {
      type: "history";
      messages: Array<{ role: "user" | "assistant"; text: string; tools?: string[]; ts?: number }>;
    };

type Handlers = {
  onEvent: (e: AgentEvent) => void;
  onStatus: (online: boolean) => void;
};

export class AgentWS {
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private backoff = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly url: string,
    private readonly secret: string,
    private readonly h: Handlers,
  ) {}

  connect(): void {
    this.closedByUser = false;
    if (!this.url) {
      this.h.onStatus(false);
      return;
    }
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.h.onStatus(false);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.backoff = 1000;
      if (this.secret) ws.send(JSON.stringify({ type: "auth", secret: this.secret }));
      this.h.onStatus(true);
    };
    ws.onmessage = (ev) => {
      try {
        this.h.onEvent(JSON.parse(ev.data) as AgentEvent);
      } catch {
        /* ignora frame inválido */
      }
    };
    ws.onclose = () => {
      this.h.onStatus(false);
      if (!this.closedByUser) this.scheduleReconnect();
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* noop */
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closedByUser) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.backoff);
    this.backoff = Math.min(Math.round(this.backoff * 1.6), 20000);
  }

  send(text: string): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "query", text }));
      return true;
    }
    return false;
  }

  clear(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "clear" }));
    }
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      this.ws?.close();
    } catch {
      /* noop */
    }
    this.ws = null;
  }
}
