# Mac Agent — detector de áudios novos

Roda como **LaunchAgent** do macOS, observa as duas pastas de áudio e dispara o webhook do n8n quando um arquivo novo aparece.

## Como funciona

```
~/Documents/AudiosMacbook   ┐
                            ├─→ fswatch ──→ audio-watcher.sh ──→ POST n8n
~/Documents/AudiosIphone    ┘                     │
                                                  ├─ ok    → move pra processed/YYYY/MM/
                                                  └─ falha → move pra failed/ + log
```

## Arquivos

- `audio-watcher.sh` — observa as pastas, faz o POST multipart
- `com.vitor.assistente-pessoal.plist` — descritor do launchd
- `install.sh` — instala fswatch (brew), renderiza o plist e carrega
- `uninstall.sh` — descarrega e remove

## Instalação

1. Na raiz do projeto: `cp .env.example .env` e preencha **pelo menos** `WEBHOOK_URL` e `WEBHOOK_TOKEN` (use um token longo e aleatório — pode gerar com `openssl rand -hex 32`).
2. `cd mac-agent && ./install.sh`
3. Pra testar: copie um `.mp3` qualquer pra `~/Documents/AudiosMacbook/` e veja `watcher.log`.

## ─────────────────────────────────────────────────────────────
## Voice Memos do iPhone — Folder Action (passo a passo)

A pasta nativa do Voice Memos (`~/Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings/`) é protegida pelo **TCC** do macOS, então o fswatch não consegue ler ela direto. A solução é configurar um **Folder Action** no Automator que copia automaticamente cada gravação nova pra `~/Documents/AudiosIphone/` (pasta livre que o watcher observa).

### Pré-requisitos
- iCloud sync das Voice Memos ativado (Ajustes → seu nome → iCloud → Voice Memos = ON, tanto no iPhone quanto no Mac)
- Os áudios gravados no iPhone caem na pasta nativa do Mac via iCloud em ~30s

### Passos

1. **Abra `Automator.app`** (Cmd+Space → "Automator")
2. Menu → **File → New** → tipo **`Folder Action`** (Ação de Pasta)
3. No topo, em **"Folder Action receives files and folders added to:"** clique no dropdown → **Other…** → digite/cole:
   ```
   ~/Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings
   ```
   - Atalho: pressione **Cmd+Shift+G** no diálogo e cole o path.
4. Na barra lateral esquerda, busque por **"Copy Finder Items"** (Copiar Itens do Finder) e **arraste pro painel direito**.
5. No bloco "Copy Finder Items", configure o destino como **`~/Documents/AudiosIphone`** (precisa criar a pasta antes se ainda não existir — `mkdir -p ~/Documents/AudiosIphone`).
6. Marque a opção **"Replacing existing files"** desativada (não substituir — manter histórico).
7. **File → Save** com o nome `Voice Memos → AudiosIphone`.
8. **Conceda permissão**: o macOS vai pedir acesso à pasta do Voice Memos na primeira execução. Aprove.

### Validação

1. Grave um voice memo curto no iPhone (10s).
2. Aguarde ~30s pro iCloud sincronizar pro Mac.
3. Confira: `ls -la ~/Documents/AudiosIphone/` — deve ter um `.m4a` novo.
4. O watcher detecta automaticamente e dispara o webhook.

### Se não funcionar

- A primeira vez exige permissão TCC pro Automator. Vai em **System Settings → Privacy & Security → Files and Folders → Automator** e garante que está ativo.
- Alternativa via Shortcuts.app: criar um **Personal Automation** disparado por "When a file is added to folder…" com a mesma lógica.

### Fallback: dar Full Disk Access ao watcher

Se quiser pular o Folder Action e fazer o `fswatch` ler direto a pasta nativa:
1. **System Settings → Privacy & Security → Full Disk Access**
2. Adicione `/opt/homebrew/bin/fswatch` (ou onde quer que o `which fswatch` aponte)
3. Adicione também o **Terminal.app** (ou iTerm) — o launchd herda permissões do contexto
4. Troque `IPHONE_FOLDER` no `.env` pra `~/Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings`

Não recomendado — Full Disk Access é amplo demais pra essa finalidade.

## ─────────────────────────────────────────────────────────────
## Operação

```bash
# Status do agent
launchctl print "gui/$(id -u)/com.vitor.assistente-pessoal" | grep -E "state|pid|last exit code"

# Logs em tempo real
tail -f watcher.log

# Forçar reinício
launchctl kickstart -k "gui/$(id -u)/com.vitor.assistente-pessoal"

# Re-processar um arquivo manualmente
./audio-watcher.sh --once "/caminho/para/arquivo.mp3"

# Limpar registro de arquivos processados (vai re-disparar tudo na próxima detecção)
rm .processed.log

# Desinstalar
./uninstall.sh
```

## Anatomia do POST

```http
POST /webhook/acoes-audio-ingest HTTP/1.1
Host: n8n-n8n.ymnmx7.easypanel.host
Content-Type: multipart/form-data; boundary=...
X-Auth: <WEBHOOK_TOKEN>
X-Source: macbook | iphone
X-Meeting-Type: online | presencial | desconhecido
X-Original-Filename: mic - 20260517 1709 .mp3
X-Recorded-At: 2026-05-17T17:09:00Z
X-Audio-Size: 136261

--boundary
Content-Disposition: form-data; name="audio"; filename="..."
Content-Type: audio/mpeg

<bytes do arquivo>
```

O webhook do n8n valida `X-Auth`, salva no volume, e dispara o pipeline.
