# Assistente de voz hands-free

Conversa falada com o Claude, sem botão. Dois modos:

- **chat** (padrão): conversa rápida, só leitura. Fala frase a frase enquanto gera.
- **coder**: você fala a tarefa, ele **escreve o código** (cria/edita arquivos, roda
  comandos) com freio de segurança, e no fim **fala um resumo breve** do que fez.

Fluxo: `mic (sox, +ganho, para no silêncio) → Whisper local (pt) → Claude Agent SDK → say`.
Diga **"tchau"** pra encerrar.

- **Auth:** herda o login do Claude Code. **Não precisa** ter o Claude Code/VSCode aberto —
  basta estar logado uma vez. Sem `ANTHROPIC_API_KEY`, sem cobrança à parte.
- **STT local:** `faster-whisper` `small` + boost de ganho no mic (offline). `medium` = +preciso.
- **Rápido:** Haiku 4.5, thinking off, fala frase-a-frase (~1s pra 1ª palavra).

## Modo chat — o jeito mais fácil (sem terminal)
**Dê dois cliques** no arquivo **`Iniciar Assistente de Voz.command`** (no Finder, dentro de
`voice-assistant/`). Na 1ª vez o macOS pede permissão de **Microfone** pro Terminal → **Permitir**.

Ou, no terminal:
```bash
~/AssistentePessoal/voice-assistant/run.sh
```
Ouça "Pode falar", espere o beep, fale, pare — vai sozinho.

## Modo coder — falar e ele programa
Abra a **pasta do projeto** no terminal (ou no terminal do VSCode com o projeto aberto) e rode:
```bash
cd ~/Documents/we.wedme           # a pasta do projeto que você quer mexer
VA_MODE=coder ~/AssistentePessoal/voice-assistant/run.sh
```
Ele trabalha **nessa pasta**. Fale a tarefa (ex.: *"crie um componente de botão e um teste"*),
ele faz tudo, roda pra validar, e **fala um resumo curto**. Se faltar algo, ele pergunta em
uma frase. Escolha o modelo com `VA_MODEL` (padrão coder = Sonnet 4.6):
```bash
VA_MODE=coder VA_MODEL=claude-opus-4-8 ~/AssistentePessoal/voice-assistant/run.sh
```
**Segurança:** comandos destrutivos (`rm -rf`, `sudo`, `git push --force`, `reset --hard`…) são
**bloqueados** automaticamente. Ele só escreve dentro da pasta de trabalho.

## Configuração (variáveis de ambiente)

| Var | Default | O que faz |
|-----|---------|-----------|
| `VA_MODE` | `chat` | `coder` = escreve código e fala só o resumo |
| `VA_MODEL` | chat:`claude-haiku-4-5` · coder:`claude-sonnet-4-6` | modelo que você escolher |
| `VA_CWD` | pasta onde você rodou | pasta de trabalho (coder) |
| `VA_WHISPER_MODEL` | `medium` | `large-v3` = +preciso/+lento · `small` = +rápido/-preciso |
| `VA_WHISPER_PROMPT` | vocabulário do Vitor | termos/nomes próprios que o Whisper deve conhecer |
| `VA_NORM` | `-1` | normaliza o pico da gravação em dB (mic alto ou baixo, sem clipar). `0` desliga |
| `VA_GAIN` | `0` | pré-ganho fixo extra em dB. `0` desliga |
| `VA_TTS` | `edge` | motor de voz: `edge` (grátis, natural, pt-BR Francisca) ou `say` (nativo macOS) |
| `VA_EDGE_VOICE` | `pt-BR-FranciscaNeural` | voz do edge-tts (ex.: `pt-BR-AntonioNeural`, `pt-BR-ThalitaNeural`) |
| `VA_EDGE_RATE` | `+8%` | velocidade do edge-tts (ex.: `+0%`, `+20%`, `-10%`) |
| `VA_VOICE` | `Luciana` | voz do `say` (fallback, veja `say -v '?'`) |
| `VA_RATE` | `190` | velocidade da fala do `say` (wpm) |
| `VA_SILENCE_PCT` | `1.5%` | gate de ruído (sobe se ambiente barulhento) |
| `VA_SILENCE_STOP` | `0.9` | seg de silêncio pra considerar que você parou |
| `VA_PROFILE` | `0` | `1` mostra tempos (stt, 1ª palavra) |

Se ele **te ouvir errado**: suba o "Volume de entrada" do mic no macOS e/ou aumente `VA_GAIN`
(ex.: `VA_GAIN=16`); se ainda errar, `VA_WHISPER_MODEL=medium`. Se **cortar sua fala no meio**:
aumente `VA_SILENCE_STOP` (ex.: `1.3`).

## Encerrar
Fale **"tchau"** / "encerrar" / "pode parar" — ou `Ctrl+C`.

## Validar sem microfone
```bash
voice-assistant/.venv/bin/python voice-assistant/selftest.py
```

## Não incluído (ideias futuras)
- Tools do dia a dia (agenda, e-mail) via `mcp_servers` (MCP por API-key).
- Barge-in (interromper a fala falando por cima); Silero VAD; voz pt-BR premium.
