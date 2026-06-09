# Vidro — Maestro de voz dentro do VSCode

Um **maestro de voz** + **vários Claude Code reais** trabalhando nos seus projetos, **à mostra no editor**. Você fala, o maestro despacha os agentes, e você **vê e confere tudo** — sem caixa-preta, sem roubar o foco, com o **seu login** (sem `ANTHROPIC_API_KEY`).

> **Totalmente separado do Mission Control.** O Vidro traz o **seu próprio motor** (uma cópia independente em `engine/`), roda na **porta 8781** com **estado próprio** em `~/.claude/vidro/`, e **nunca** toca em `~/.claude/command-center` nem na porta 8770. Os agentes do Vidro são dele; os do Mission Control continuam separados.

## Por que existe
O problema nunca foi orquestrar — foi **confiar**. O Vidro deixa o Claude Code à mostra:
- **Sidebar de Agentes** (projetos → agentes → tarefas) com status ao vivo.
- **Rail do Maestro** (conversa + atividade + cards de aprovação) por voz e texto.
- **Confirmação de mutações** (cards Aprovar/Negar) — destrutivos sempre bloqueados pelo motor.
- **Abrir no terminal** (`claude --resume <id>`): veja/continue a **mesma** sessão real.
- **Assumir agente (handoff)**: pausa o piloto automático e te dá o teclado (um motorista por vez).
- **Desfazer** as mudanças de uma tarefa (rewind de arquivos).

## Pré-requisitos
- macOS, **VSCode ≥ 1.95**.
- A **venv de voz** `~/.claude/voice/.venv` (já usada pelo voice-assistant/command-center), com `claude-agent-sdk`, `fastapi`, `uvicorn`, `faster-whisper`. (É só infra de Python/voz — não é o Mission Control.)
- `sox` para a voz: `brew install sox`.
- Estar logado no Claude Code (a extensão herda o login; nada de API key).

## Rodar em desenvolvimento (F5)
```bash
cd ~/AssistentePessoal/vscode-vidro
npm install
npm run build
```
Abra esta pasta no VSCode e pressione **F5** (Run Extension). Uma janela "Extension Development Host" abre com o ícone **Vidro** na activity bar. A extensão **sobe o motor próprio sozinha** (headless, porta 8781) se ele não estiver no ar.

## Instalar de vez (.vsix)
```bash
npm run package          # gera vidro-0.1.0.vsix (com o engine/ embutido)
```
No VSCode: **Extensions → … → Install from VSIX** → escolha `vidro-0.1.0.vsix`. (Sem `code` CLI; ou habilite com *"Shell Command: Install 'code' command in PATH"*.)

## Uso
- **Falar:** `Cmd+Shift+M` (ou o botão 🎙️ no rail / na barra de status) → fale → o maestro recebe e responde por voz.
- **Texto:** caixa no rail do Maestro, ou `Cmd+Alt+V`.
- **Novo agente:** botão `+` na sidebar → escolha projeto, tarefa e modo.
- **Aprovações:** aparecem como card (voz do maestro avisa) → Aprovar/Negar.
- **Por agente** (menu de contexto na sidebar): falar direto, abrir no terminal, ver mudanças, desfazer, assumir/devolver, trocar modo, pausar/encerrar.

## Arquitetura
Extensão TypeScript = **cliente nativo** do motor (cópia própria) via HTTP + WebSocket (`/ws`, `/command`, `/voice`, `/spawn`, `/approve`, `/agent/*`, `/say`). O motor (provado, vindo do Mission Control mas **vendorizado**) mantém maestro (Opus), agentes (Claude Code via SDK, login herdado), hook de permissão, checkpoints/undo, resume de sessão e voz (Whisper STT + Piper TTS).

- `engine/` — cópia INDEPENDENTE do motor (porta 8781, estado em `~/.claude/vidro/`, `CC_HEADLESS=1`).
- `src/backend.ts` — sobe `engine/run.sh` + cliente HTTP.
- `src/wsclient.ts` — WebSocket com reconexão.
- `src/store.ts` — estado vivo (agentes/feed/aprovações/conversa).
- `src/agentsTree.ts` — sidebar nativa.
- `src/maestroView.ts` — webview do maestro.
- `src/voice.ts` — grava com `sox` e envia pro `/voice` (webview não acessa mic).
- `src/commands.ts` — todos os comandos.

## Limites honestos (v1)
- O microfone é capturado por **subprocesso `sox`** (o webview do VSCode bloqueia mic) — na prática é o mic do seu Mac + Whisper local, igual ao voice-assistant.
- "Ver acontecer" = **log + diff nativo + abrir-no-terminal** (não há "terminal ao vivo + diffs" na mesma run — limitação da API do VSCode).
- "Ver mudanças" usa o Git nativo (`git.openChange`) quando disponível.
- Reusa a **venv de voz** e o **daemon Piper (8765)** como infra compartilhada (não é o Mission Control). Isolar voz por completo fica pra depois, se quiser.
- Uso **pessoal/local** (herda seu login). Distribuir pra terceiros esbarra na política de login da Anthropic.
