// Rail do Maestro (webview): conversa + feed + cards de aprovação + mic + voz on/off.
import * as vscode from "vscode";
import { Store } from "./store";
import { Backend } from "./backend";

export class MaestroView implements vscode.WebviewViewProvider {
  public static readonly viewType = "vidro.maestro";
  private view?: vscode.WebviewView;
  private listening = false;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly store: Store,
    private readonly backend: Backend,
    private readonly onMic: () => void
  ) {
    store.onMaestro(() => this.push());
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.ctx.extensionUri] };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage(async (m) => {
      try {
        switch (m?.cmd) {
          case "ready":
            this.push();
            this.view?.webview.postMessage({ type: "listening", on: this.listening });
            break;
          case "send":
            if ((m.text || "").trim()) await this.backend.command(String(m.text).trim());
            break;
          case "mic":
            this.onMic();
            break;
          case "approve":
            await this.backend.approve(m.id, !!m.ok);
            break;
          case "toggleAudio":
            await this.backend.setAudio(!this.store.audio);
            break;
          case "hush":
            await this.backend.hush();
            break;
          case "say":
            if ((m.text || "").trim()) await this.backend.say(String(m.text).trim());
            break;
        }
      } catch (e) {
        vscode.window.showErrorMessage(`Vidro: ${(e as Error).message}`);
      }
    });
    this.push();
  }

  private push() {
    if (!this.view) return;
    this.view.webview.postMessage({
      type: "state",
      connected: this.store.connected,
      audio: this.store.audio,
      convo: this.store.convo.slice(-120),
      feed: this.store.feed.slice(0, 20),
      approvals: [...this.store.approvals.values()],
    });
  }

  flashListening(on: boolean) {
    this.listening = on;
    this.view?.webview.postMessage({ type: "listening", on });
  }

  private html(webview: vscode.Webview): string {
    const nonce = String(Math.random()).slice(2);
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    return `<!DOCTYPE html><html lang="pt-br"><head>
<meta charset="utf-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<style>
  :root { color-scheme: light dark; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); margin: 0; padding: 8px; }
  .status { font-size: 11px; opacity: .7; margin-bottom: 6px; display:flex; align-items:center; gap:6px; }
  .dot { width:8px;height:8px;border-radius:50%;background:var(--vscode-charts-red); }
  .dot.on { background:var(--vscode-charts-green); }
  .row { display:flex; gap:6px; margin-bottom:8px; }
  input,button,textarea { font-family:inherit; font-size:inherit; }
  #q { flex:1; padding:6px 8px; background:var(--vscode-input-background); color:var(--vscode-input-foreground); border:1px solid var(--vscode-input-border,transparent); border-radius:6px; }
  button { cursor:pointer; background:var(--vscode-button-background); color:var(--vscode-button-foreground); border:none; border-radius:6px; padding:6px 10px; }
  button.sec { background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); }
  button.mic.listening { background:var(--vscode-charts-red); }
  .convo { display:flex; flex-direction:column; gap:6px; margin-top:8px; }
  .turn { padding:6px 8px; border-radius:8px; white-space:pre-wrap; word-break:break-word; }
  .turn.user { background:var(--vscode-input-background); align-self:flex-end; max-width:90%; }
  .turn.maestro { background:var(--vscode-editorWidget-background,rgba(127,127,127,.12)); max-width:95%; }
  .turn.event { opacity:.7; font-size:12px; font-style:italic; }
  .ts { font-size:10px; opacity:.5; margin-top:2px; }
  .appr { border:1px solid var(--vscode-charts-yellow); border-radius:8px; padding:8px; margin:6px 0; }
  .appr code { display:block; background:var(--vscode-textCodeBlock-background); padding:6px; border-radius:6px; margin:4px 0; white-space:pre-wrap; }
  .feed { margin-top:10px; border-top:1px solid var(--vscode-panel-border); padding-top:6px; }
  .feed h4 { margin:0 0 4px; font-size:11px; opacity:.6; font-weight:600; text-transform:uppercase; letter-spacing:.04em; }
  .fi { font-size:12px; padding:2px 0; opacity:.85; }
  .k-done{color:var(--vscode-charts-green)} .k-error{color:var(--vscode-charts-red)} .k-working{color:var(--vscode-charts-blue)} .k-waiting{color:var(--vscode-charts-yellow)}
</style></head>
<body>
  <div class="status"><span id="dot" class="dot"></span><span id="statustxt">conectando…</span></div>
  <div class="row">
    <input id="q" placeholder="Fale com o maestro… (Enter envia)"/>
    <button id="sendb" title="Enviar">Enviar</button>
  </div>
  <div class="row">
    <button id="micb" class="mic sec" title="Falar (microfone)">🎙️ Falar</button>
    <button id="audiob" class="sec" title="Ligar/desligar voz">🔊 Voz</button>
    <button id="hushb" class="sec" title="Calar tudo">🤫</button>
  </div>
  <div id="approvals"></div>
  <div id="convo" class="convo"></div>
  <div class="feed"><h4>Atividade</h4><div id="feed"></div></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const stripTags = (s) => (s||'').replace(/<[^>]+>/g,'');
  function fmtTs(ts){ if(!ts) return ''; try { return new Date(ts).toLocaleTimeString(); } catch(e){ return ''; } }

  function send(){ const t=$('q').value.trim(); if(t){ vscode.postMessage({cmd:'send',text:t}); $('q').value=''; } }
  $('sendb').onclick = send;
  $('q').addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); send(); } });
  $('micb').onclick = ()=> vscode.postMessage({cmd:'mic'});
  $('audiob').onclick = ()=> vscode.postMessage({cmd:'toggleAudio'});
  $('hushb').onclick = ()=> vscode.postMessage({cmd:'hush'});

  function renderApprovals(list){
    const box = $('approvals'); box.replaceChildren();
    for (const a of (list||[])) {
      const d = el('div','appr');
      d.append(el('span', null, '⚠️ '));
      d.append(el('b', null, a.project));
      d.append(el('span', null, ' quer rodar '));
      d.append(el('b', null, a.tool));
      d.append(el('span', null, ':'));
      d.append(el('code', null, a.preview));
      const ok = el('button', null, 'Aprovar');
      ok.addEventListener('click', ()=> vscode.postMessage({cmd:'approve', id:a.id, ok:true}));
      const no = el('button','sec','Negar');
      no.addEventListener('click', ()=> vscode.postMessage({cmd:'approve', id:a.id, ok:false}));
      d.append(ok); d.append(document.createTextNode(' ')); d.append(no);
      box.append(d);
    }
  }
  function renderConvo(list){
    const box = $('convo'); box.replaceChildren();
    for (const t of (list||[])) {
      const k = t.kind==='user'?'user':(t.kind==='event'?'event':'maestro');
      const d = el('div','turn '+k, t.text);
      if (t.ts) d.append(el('div','ts', fmtTs(t.ts)));
      box.append(d);
    }
    box.scrollTop = 1e9;
  }
  function renderFeed(list){
    const box = $('feed'); box.replaceChildren();
    for (const f of (list||[])) box.append(el('div','fi k-'+(f.kind||''), '• ' + stripTags(f.text)));
  }

  window.addEventListener('message', (ev)=>{
    const m = ev.data;
    if(m.type==='listening'){ $('micb').classList.toggle('listening', !!m.on); $('micb').textContent = m.on ? '● ouvindo…' : '🎙️ Falar'; return; }
    if(m.type!=='state') return;
    $('dot').classList.toggle('on', m.connected);
    $('statustxt').textContent = m.connected ? 'motor conectado' : 'motor offline';
    $('audiob').textContent = m.audio ? '🔊 Voz' : '🔇 Voz';
    renderApprovals(m.approvals);
    renderConvo(m.convo);
    renderFeed(m.feed);
  });
  vscode.postMessage({cmd:'ready'});
</script></body></html>`;
  }
}
