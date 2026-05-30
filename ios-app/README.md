# TTARS BR — App iOS

> Codinome interno do projeto Xcode: `WelcomeAssistente` (não muda nada visível pro usuário).
> Display name no iPhone: **TTARS BR**. Bundle ID: `br.com.ttars`.

Captura de áudio sob demanda + upload pro `ingest-svc`. Auth por convite via Universal Link.
Thin client: tudo que não for gravar/upload abre o site no Safari.

> **Status:** scaffolding criado. Falta: gerar `.xcodeproj` (XcodeGen), preencher Team ID,
> rodar primeira build e submeter pro TestFlight.

## Stack

- Swift 6 + SwiftUI (iOS 18+, iPhone only)
- `AVAudioRecorder` (mic) + `AVAudioSession` `.playAndRecord` (grava com tela bloqueada)
- `URLSession` async/await + multipart upload
- Keychain pra session_token
- FileManager pra fila persistente de uploads (retry em launch / após pull-to-refresh)
- `SFSafariViewController` pra abrir páginas web da reunião

## Estrutura

```
ios-app/
├── README.md                            # você está aqui
├── project.yml                          # XcodeGen — gera o .xcodeproj
├── .gitignore                           # ignora xcodeproj/build/etc
├── Configs/
│   ├── Debug.xcconfig                   # URLs do ambiente de dev
│   └── Release.xcconfig                 # URLs do prod
└── WelcomeAssistente/
    ├── App/
    │   ├── WelcomeAssistenteApp.swift   # @main + Universal Link handler
    │   ├── ContentView.swift            # Root: Onboarding vs MainTabView
    │   └── Configuration.swift          # lê WelcomeBaseURL/IngestURL do Info.plist
    ├── Auth/
    │   ├── AuthStore.swift              # @Observable; restore/login/logout
    │   └── KeychainStorage.swift        # session_token, user_id em Keychain
    ├── Networking/
    │   └── APIClient.swift              # exchange, listMeetings, uploadAudio
    ├── Models/
    │   ├── Meeting.swift                # decodifica /api/mobile/meetings
    │   └── PendingRecording.swift       # estado local de gravação pendente
    ├── Recording/
    │   ├── AudioRecorder.swift          # AVAudioRecorder + meter + permissões
    │   ├── UploadQueue.swift            # persistente; retry; deleta após sucesso
    │   └── RecordView.swift             # tela principal (botão record/stop)
    ├── History/
    │   └── HistoryView.swift            # lista pendentes + reuniões do servidor
    ├── Onboarding/
    │   └── OnboardingView.swift         # código de convite + nome
    ├── Settings/
    │   └── SettingsView.swift           # logout, termos, versão
    ├── Resources/
    │   ├── Info.plist                   # permissões mic + UIBackgroundModes + URLs
    │   ├── PrivacyInfo.xcprivacy        # nutrition labels (obrigatório 2024+)
    │   └── WelcomeAssistente.entitlements  # Associated Domains (Universal Links)
    └── Assets.xcassets/                 # AppIcon + AccentColor (template)
```

---

## 🚀 Setup inicial (primeira vez)

### 1. Pré-requisitos

- **macOS** Sequoia 15+ ou Tahoe 26+
- **Xcode 16.0+** — Mac App Store: https://apps.apple.com/app/xcode/id497799835
- **Apple Developer Program** ativo ($99/ano): https://developer.apple.com/programs/enroll/
- **Homebrew** — https://brew.sh
- **XcodeGen** — `brew install xcodegen`

### 2. Configurar Apple Developer

Antes de buildar precisa de:

1. **Team ID** — pegue em https://developer.apple.com/account
   - Painel > "Membership" > copia o "Team ID" (10 chars, tipo `ABCDE12345`)

2. **Bundle ID registrado** — https://developer.apple.com/account/resources/identifiers/list
   - Click "+" → "App IDs" → "App"
   - Description: `Welcome Assistente`
   - Bundle ID: `br.com.ttars` (Explicit)
   - Capabilities: marca `Associated Domains` e `Push Notifications` (futuro)
   - Continue → Register

3. **App no App Store Connect** — https://appstoreconnect.apple.com/apps
   - "+" → "New App"
   - Platforms: iOS
   - Name: `Welcome`
   - Primary Language: Portuguese (Brazil)
   - Bundle ID: `br.com.ttars`
   - SKU: `welcome-assistente-001`

### 3. Editar configs

Abre `Configs/Debug.xcconfig` e `Configs/Release.xcconfig` e preenche **se for usar
domínios diferentes**. Por padrão:

- Debug: `n8n-assistente-frontend.tatetz.easypanel.host` (easypanel)
- Release: `acoes.vitorgambetti.com.br` (custom, ainda em 404 — corrigir antes de TestFlight)

> ⚠️ **Universal Links exigem HTTPS válido + arquivo `apple-app-site-association` no domínio.**
> O arquivo já foi criado em `frontend/public/.well-known/apple-app-site-association` mas
> precisa ter o **Team ID real** (substituir `REPLACE_WITH_TEAM_ID`) e o domínio precisa
> responder com `Content-Type: application/json`. Já configurado em `next.config.ts`.

### 4. Atualizar Team ID em 2 lugares

**Em `frontend/public/.well-known/apple-app-site-association`:**

```diff
- "appID": "REPLACE_WITH_TEAM_ID.br.com.ttars",
+ "appID": "ABCDE12345.br.com.ttars",
```

Depois faça redeploy do frontend pra publicar.

**Em Xcode** (depois do `xcodegen generate`):
1. Abre `WelcomeAssistente.xcodeproj`
2. Seleciona target `WelcomeAssistente` > tab **Signing & Capabilities**
3. Marca "Automatically manage signing"
4. Team: seleciona seu time
5. Xcode baixa provisioning profile automaticamente

### 5. Gerar o projeto Xcode

```bash
cd ios-app
xcodegen generate
open WelcomeAssistente.xcodeproj
```

### 6. Rodar no simulador

Em Xcode:
1. Seleciona scheme `WelcomeAssistente` (canto superior esquerdo)
2. Seleciona destination: `iPhone 16 Pro` (ou qualquer iPhone simulator)
3. ⌘R (Run)

No simulador:
- Aparece a tela de Onboarding
- Crie um convite em `<frontend>/admin/convites` (logado como admin no site)
- Cole o código + seu nome → "Entrar"
- Aceita os termos (sheet do Safari abre `/termos`)
- Cai na tela de Gravar
- Aperta o botão grande → autoriza microfone → grava alguns segundos → para
- Vai na aba Histórico → vê a gravação como "Enviando..."
- Aguarda ~1 min → status muda pra "Pronto"

**Importante:** simulador ≠ iPhone físico. Gravação background com tela bloqueada
só dá pra validar em device real.

---

## 📱 Build pra TestFlight

### 1. Bump version & build

Edita `Configs/Release.xcconfig`:

```diff
- MARKETING_VERSION = 1.0.0
- CURRENT_PROJECT_VERSION = 1
+ MARKETING_VERSION = 1.0.0
+ CURRENT_PROJECT_VERSION = 2  # bump a cada upload
```

Regera o project: `xcodegen generate`.

### 2. Archive

Xcode:
1. Conecta um iPhone real OU seleciona `Any iOS Device (arm64)` como destination
2. **Product → Archive**
3. Espera build (~3-5 min)
4. Organizer abre automaticamente quando termina

### 3. Distribute → TestFlight

No Organizer:
1. Seleciona o archive recém-criado
2. Click **Distribute App**
3. Method: **App Store Connect**
4. Destination: **Upload**
5. Marca as opções recomendadas (Strip Symbols, Manage Version Automatically se quiser)
6. Aguarda upload (~5 min)
7. App Store Connect notifica por email quando processa (~10-30 min)

### 4. Liberar pros testers no TestFlight

https://appstoreconnect.apple.com/apps → seu app → tab **TestFlight**

**Primeira vez (precisa Beta App Review):**
1. Espera o build aparecer com status "Processing" → "Ready to Test"
2. Vai em **Test Information** → preenche obrigatórios:
   - Beta App Description (o que é o app)
   - Feedback Email: `marcelo@welcometrips.com.br`
   - Privacy Policy URL: `<frontend>/termos`
3. Vai em **External Testing** → cria grupo `Beta Privado`
4. Adiciona o build ao grupo
5. **Apple aprova Beta App Review em 24-72h** (só na 1ª build de cada major; updates passam direto)
6. Convida testers por email OU gera link público

**Builds expiram em 90 dias** — bump CURRENT_PROJECT_VERSION e reupload periodicamente.

---

## 🐛 Troubleshooting

### "Code signing failed"
- Tab **Signing & Capabilities** → Team selecionado? Bundle ID bate com o registrado?
- Se persistir: `Xcode → Settings → Accounts → seu Apple ID → Download Manual Profiles`

### "Microphone not allowed" no iPhone físico
- Ajustes do iOS → Welcome → ativa **Microfone**
- Se nem aparece o app em Ajustes: o `NSMicrophoneUsageDescription` no Info.plist
  pode estar vazio — verifica em build

### Universal Link não abre o app
- Confirma `apple-app-site-association` retorna `200` com `Content-Type: application/json`:
  ```bash
  curl -I https://acoes.vitorgambetti.com.br/.well-known/apple-app-site-association
  # Deve ter: Content-Type: application/json
  ```
- Bundle ID no AASA = `<TEAM_ID>.br.com.ttars` (com Team ID real)
- Após instalar pela 1ª vez, espera ~30s pro iOS sync. Reinstala se precisar.

### Upload 401 Bearer
- `INTERNAL_SVC_TOKEN` precisa estar setado E **idêntico** entre frontend env e ingest-svc env
- `FRONTEND_INTERNAL_URL` do ingest-svc precisa apontar pra um endpoint que ele consegue
  alcançar (em easypanel: `http://assistente-frontend:3000`)

### Upload 502
- Frontend rejeitou — provavelmente token expirado/revogado. App deve cair em logout
  na próxima `/api/auth/mobile/exchange?session_token` (refresh)

---

## 📋 Checklist pré-TestFlight

- [ ] Apple Developer Program ativo
- [ ] App registrado em https://developer.apple.com/account/resources/identifiers/list
- [ ] App criado em App Store Connect
- [ ] `Configs/Release.xcconfig` com URLs corretas
- [ ] `frontend/public/.well-known/apple-app-site-association` com Team ID real
- [ ] `ingest-svc` deployado e respondendo `GET /health` 200
- [ ] `INTERNAL_SVC_TOKEN` setado no env do frontend E do ingest-svc (mesma string)
- [ ] App icon 1024x1024 em `WelcomeAssistente/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png`
- [ ] Privacy nutrition labels preenchidos no App Store Connect
- [ ] Convite teste criado em `/admin/convites`
- [ ] Build em iPhone físico testada com Universal Link
