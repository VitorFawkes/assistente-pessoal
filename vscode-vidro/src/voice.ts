// Captura de voz: grava do microfone com VAD (sox/rec) no extension host e envia pro motor (/voice).
// Webview do VSCode não acessa o microfone — por isso gravamos via subprocesso (igual ao voice-assistant).
import * as vscode from "vscode";
import * as cp from "child_process";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { Backend } from "./backend";

export class Voice {
  private recording = false;

  constructor(
    private readonly backend: Backend,
    private readonly out: vscode.OutputChannel,
    private readonly onListening: (on: boolean) => void
  ) {}

  get isRecording() {
    return this.recording;
  }

  async captureAndSend(): Promise<void> {
    if (this.recording) {
      this.out.appendLine("[voz] já gravando — ignorando.");
      return;
    }
    const cfg = vscode.workspace.getConfiguration("vidro");
    const bin = cfg.get<string>("recorder", "rec");
    const stop = cfg.get<string>("micSilenceStop", "0.9");
    const wav = path.join(os.tmpdir(), `vidro_${Date.now()}.wav`);

    // rec -q -c 1 -r 16000 -b 16 <wav> silence 1 0.1 1.5% 1 <stop> 1.5%
    const args =
      bin === "sox"
        ? ["-d", "-q", "-c", "1", "-r", "16000", "-b", "16", wav, "silence", "1", "0.1", "1.5%", "1", stop, "1.5%"]
        : ["-q", "-c", "1", "-r", "16000", "-b", "16", wav, "silence", "1", "0.1", "1.5%", "1", stop, "1.5%"];

    this.recording = true;
    this.onListening(true);
    vscode.window.setStatusBarMessage("$(mic) Vidro ouvindo…", 4000);
    this.out.appendLine(`[voz] gravando (${bin})…`);

    const ok = await new Promise<boolean>((resolve) => {
      let proc: cp.ChildProcess;
      try {
        proc = cp.spawn(bin, args);
      } catch (e) {
        this.out.appendLine(`[voz] falha ao iniciar '${bin}': ${(e as Error).message}. Instale o sox (brew install sox).`);
        resolve(false);
        return;
      }
      proc.on("error", (e) => {
        this.out.appendLine(`[voz] erro do gravador: ${(e as Error).message}. Instale o sox (brew install sox).`);
        resolve(false);
      });
      proc.on("exit", () => resolve(fs.existsSync(wav) && fs.statSync(wav).size > 2000));
      // failsafe: limita a 30s
      setTimeout(() => {
        try {
          proc.kill("SIGINT");
        } catch { /* ignore */ }
      }, 30000);
    });

    this.recording = false;
    this.onListening(false);

    if (!ok) {
      vscode.window.showWarningMessage("Vidro: não captei áudio (sox instalado? microfone permitido para o VSCode?).");
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
}

function cleanup(p: string) {
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch { /* ignore */ }
}
