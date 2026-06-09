// Captura de voz: grava do microfone com VAD (sox/rec) no extension host e envia pro motor (/voice).
// Webview do VSCode não acessa o microfone — por isso gravamos via subprocesso (igual ao voice-assistant).
// O mic é LIGA/DESLIGA: toca pra começar, toca de novo pra PARAR e enviar. Estado sempre limpa.
import * as vscode from "vscode";
import * as cp from "child_process";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { Backend } from "./backend";

export class Voice {
  private recording = false;
  private proc: cp.ChildProcess | undefined;
  private wav: string | undefined;
  private discard = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly backend: Backend,
    private readonly out: vscode.OutputChannel,
    private readonly onListening: (on: boolean) => void
  ) {}

  get isRecording() {
    return this.recording;
  }

  // Toggle: gravando → finaliza e envia; parado → começa a gravar.
  async captureAndSend(): Promise<void> {
    if (this.recording) {
      this.stop(false);
      return;
    }
    const cfg = vscode.workspace.getConfiguration("vidro");
    const bin = cfg.get<string>("recorder", "rec");
    const stop = cfg.get<string>("micSilenceStop", "0.9");
    const wav = path.join(os.tmpdir(), `vidro_${Date.now()}.wav`);
    // rec -q -c 1 -r 16000 -b 16 <wav> silence 1 0.1 1.5% 1 <stop> 1.5%
    const silence = ["silence", "1", "0.1", "1.5%", "1", stop, "1.5%"];
    const base = ["-q", "-c", "1", "-r", "16000", "-b", "16", wav];
    const args = bin === "sox" ? ["-d", ...base, ...silence] : [...base, ...silence];

    this.discard = false;
    this.wav = wav;
    let proc: cp.ChildProcess;
    try {
      proc = cp.spawn(bin, args);
    } catch (e) {
      this.fail(`falha ao iniciar '${bin}' (instale o sox: brew install sox): ${(e as Error).message}`);
      return;
    }
    this.proc = proc;
    this.recording = true;
    this.onListening(true);
    vscode.window.setStatusBarMessage("$(mic) Vidro ouvindo… (clique no mic pra parar)", 4000);
    this.out.appendLine(`[voz] gravando (${bin}) — toque o mic de novo pra parar.`);

    proc.on("error", (e) => this.fail(`erro do gravador (sox instalado?): ${(e as Error).message}`));
    proc.on("exit", () => this.finish());
    // failsafe: para sozinho em 60s pra nunca ficar preso
    this.timer = setTimeout(() => {
      this.out.appendLine("[voz] failsafe 60s — parando.");
      try {
        proc.kill("SIGINT");
      } catch { /* ignore */ }
    }, 60000);
  }

  // Para a gravação atual. discard=true descarta sem enviar.
  stop(discard: boolean) {
    if (!this.recording || !this.proc) {
      // nada gravando: garante que o indicador não fique preso
      this.onListening(false);
      return;
    }
    this.discard = discard;
    this.out.appendLine(discard ? "[voz] cancelado." : "[voz] parando e enviando…");
    try {
      this.proc.kill("SIGINT");
    } catch {
      try {
        this.proc.kill("SIGTERM");
      } catch { /* ignore */ }
    }
  }

  // Zera estado preso (defensivo).
  forceReset() {
    if (this.timer) clearTimeout(this.timer);
    try {
      this.proc?.kill("SIGKILL");
    } catch { /* ignore */ }
    cleanup(this.wav);
    this.recording = false;
    this.proc = undefined;
    this.wav = undefined;
    this.onListening(false);
  }

  private async finish() {
    if (this.timer) clearTimeout(this.timer);
    const wav = this.wav;
    const discard = this.discard;
    this.recording = false;
    this.proc = undefined;
    this.wav = undefined;
    this.onListening(false);

    if (discard) {
      cleanup(wav);
      return;
    }
    if (!wav || !fs.existsSync(wav) || fs.statSync(wav).size < 2000) {
      vscode.window.setStatusBarMessage("$(mic) Vidro: não captei áudio.", 3000);
      cleanup(wav);
      return;
    }
    try {
      const res = await this.backend.sendVoiceFile(wav);
      if (res?.text) {
        this.out.appendLine(`[voz] você: ${res.text}`);
        vscode.window.setStatusBarMessage(`$(comment) "${res.text}"`, 5000);
      } else {
        vscode.window.setStatusBarMessage("$(mic) Vidro: não entendi.", 3000);
      }
    } catch (e) {
      vscode.window.showErrorMessage(`Vidro (voz): ${(e as Error).message}`);
    } finally {
      cleanup(wav);
    }
  }

  private fail(msg: string) {
    if (this.timer) clearTimeout(this.timer);
    cleanup(this.wav);
    this.recording = false;
    this.proc = undefined;
    this.wav = undefined;
    this.onListening(false);
    this.out.appendLine(`[voz] ${msg}`);
    vscode.window.showWarningMessage(`Vidro (voz): ${msg}`);
  }
}

function cleanup(p?: string) {
  try {
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  } catch { /* ignore */ }
}
