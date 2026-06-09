// Conexão WebSocket com o motor (/ws), com reconexão automática.
import * as vscode from "vscode";
import WebSocket from "ws";
import { WsMessage } from "./types";

export class WsClient {
  private ws: WebSocket | undefined;
  private closed = false;
  private retry = 0;
  private readonly _onMessage = new vscode.EventEmitter<WsMessage>();
  private readonly _onStatus = new vscode.EventEmitter<boolean>();
  readonly onMessage = this._onMessage.event;
  readonly onStatus = this._onStatus.event; // true = conectado

  constructor(private readonly port: number, private readonly out: vscode.OutputChannel) {}

  start() {
    this.closed = false;
    this.connect();
  }

  private connect() {
    if (this.closed) return;
    const url = `ws://127.0.0.1:${this.port}/ws`;
    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      this.scheduleReconnect();
      return;
    }
    this.ws.on("open", () => {
      this.retry = 0;
      this.out.appendLine("[ws] conectado.");
      this._onStatus.fire(true);
    });
    this.ws.on("message", (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString()) as WsMessage;
        this._onMessage.fire(msg);
      } catch {
        /* ignore */
      }
    });
    this.ws.on("close", () => {
      this._onStatus.fire(false);
      this.scheduleReconnect();
    });
    this.ws.on("error", (err) => {
      this.out.appendLine(`[ws] erro: ${(err as Error).message}`);
      try {
        this.ws?.close();
      } catch { /* ignore */ }
    });
  }

  private scheduleReconnect() {
    if (this.closed) return;
    this.retry = Math.min(this.retry + 1, 10);
    const wait = Math.min(500 * this.retry, 5000);
    setTimeout(() => this.connect(), wait);
  }

  dispose() {
    this.closed = true;
    try {
      this.ws?.close();
    } catch { /* ignore */ }
    this._onMessage.dispose();
    this._onStatus.dispose();
  }
}
