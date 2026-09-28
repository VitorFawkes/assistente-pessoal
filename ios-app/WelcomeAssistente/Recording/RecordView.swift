import AVFoundation
import SwiftUI

struct RecordView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(UploadQueue.self) private var queue
    @Environment(AudioRecorder.self) private var recorder
    @Environment(\.scenePhase) private var scenePhase
    let verReunioes: () -> Void

    @State private var permissionDenied = false
    @State private var errorMessage: String?
    @State private var terminou = false
    @State private var mostrarGuia = false

    var body: some View {
        NavigationStack {
            ZStack {
                FundoEspaco()
                VStack(spacing: 0) {
                    cabecalho
                    if auth.emDemonstracao {
                        Text("Demonstração: nada é enviado.")
                            .font(.footnote)
                            .foregroundStyle(Estilo.ouro)
                            .padding(.horizontal, 14).padding(.vertical, 7)
                            .overlay(Capsule().stroke(Estilo.ouro.opacity(0.5)))
                            .padding(.top, 12)
                    }
                    Spacer(minLength: 8)
                    heroi
                    timerLabel.padding(.top, 14)
                    Spacer(minLength: 8)
                    controles
                    Spacer(minLength: 8)
                    statusText
                    envioText.padding(.top, 6)
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 12)
            }
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $mostrarGuia) {
                NavigationStack {
                    BotaoTelaBloqueadaView()
                        .toolbar { Button("OK") { mostrarGuia = false } }
                }
            }
            .alert("Microfone bloqueado", isPresented: $permissionDenied) {
                Button("Abrir Ajustes") { openSettings() }
                Button("Cancelar", role: .cancel) {}
            } message: {
                Text("Para gravar reuniões, ligue o microfone em Ajustes → CASE.")
            }
            .alert("Não deu para gravar", isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button("OK") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
            .task {
                // Enquanto o app está aberto, tenta subir o que ficou na fila a cada minuto.
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(60))
                    if scenePhase == .active { await queue.enviarPendentes() }
                }
            }
        }
    }

    // MARK: - partes da tela

    private var cabecalho: some View {
        HStack {
            Text("CASE")
                .font(.system(size: 20, weight: .semibold))
                .tracking(7)
                .foregroundStyle(.white)
            Spacer()
            HStack(spacing: 6) {
                Circle().fill(corDoEstado).frame(width: 7, height: 7)
                Text(textoDoEstado).font(.caption.weight(.semibold)).tracking(1.5)
            }
            .foregroundStyle(.white.opacity(0.85))
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(Capsule().fill(Estilo.placa))
            .overlay(Capsule().stroke(Estilo.borda))
        }
        .padding(.top, 8)
    }

    private var textoDoEstado: String {
        switch recorder.state {
        case .idle: "PRONTO"
        case .recording: "GRAVANDO"
        case .pausado: "PAUSADO"
        case .interrompido: "PAROU"
        }
    }

    private var corDoEstado: Color {
        switch recorder.state {
        case .idle: .white.opacity(0.4)
        case .recording: Estilo.gravando
        case .pausado, .interrompido: Estilo.ouro
        }
    }

    /// O ícone vivo: o robô no buraco negro, com o anel do Gargantua em volta.
    private var heroi: some View {
        ZStack {
            AnelGargantua(espessura: 9, brilho: isRecording ? 1 : 0.8)
                .frame(width: 250, height: 250)
            Circle()
                .fill(RadialGradient(colors: [.black, .black, .black.opacity(0)], center: .center,
                                     startRadius: 0, endRadius: 118))
                .frame(width: 236, height: 236)
            RoboCASE(nivel: recorder.meterLevel, gravando: isRecording)
                .frame(width: 98, height: 172)
        }
        .frame(height: 280)
        .accessibilityHidden(true)
    }

    private var timerLabel: some View {
        Text(formatElapsed(recorder.elapsedSeconds))
            .font(.system(size: 50, weight: .light, design: .monospaced))
            .foregroundStyle(recorder.state == .idle ? .white.opacity(0.55) : .white)
            .contentTransition(.numericText())
    }

    @ViewBuilder
    private var controles: some View {
        if recorder.state == .interrompido || recorder.state == .pausado {
            parado
        } else {
            HStack(spacing: 30) {
                if isRecording { botaoPausar } else { Color.clear.frame(width: 64, height: 64) }
                recordButton
                Color.clear.frame(width: 64, height: 64)
            }
        }
    }

    private var recordButton: some View {
        Button(action: toggleRecording) {
            ZStack {
                Circle().fill(Color.black).frame(width: 92, height: 92)
                Circle()
                    .stroke(LinearGradient(colors: [Estilo.ouroClaro, Estilo.ouro, Estilo.ouroForte],
                                           startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 3)
                    .frame(width: 92, height: 92)
                if isRecording {
                    RoundedRectangle(cornerRadius: 7).fill(Estilo.gravando).frame(width: 30, height: 30)
                } else {
                    Circle().fill(Estilo.gravando).frame(width: 66, height: 66)
                        .shadow(color: Estilo.gravando.opacity(0.55), radius: 14)
                }
            }
            .animation(.spring(duration: 0.3), value: isRecording)
        }
        .buttonStyle(Apertar())
        .accessibilityLabel(isRecording ? "Parar a gravação" : "Começar a gravar")
    }

    private var botaoPausar: some View {
        Button {
            ControleGravacao.shared.pausar()
        } label: {
            Image(systemName: "pause.fill")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 64, height: 64)
                .background(Circle().fill(Estilo.placa))
                .overlay(Circle().stroke(Estilo.borda))
        }
        .buttonStyle(Apertar())
        .accessibilityLabel("Pausar a gravação")
    }

    private var parado: some View {
        VStack(spacing: 12) {
            Text(recorder.state == .pausado
                 ? "Gravação pausada. O que foi gravado está salvo."
                 : "A gravação parou (ligação ou outro app usou o microfone). O que foi gravado está salvo.")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.7))
                .multilineTextAlignment(.center)
            Button {
                do {
                    try ControleGravacao.shared.continuar()
                } catch {
                    errorMessage = error.localizedDescription
                }
            } label: {
                Label("Continuar gravando", systemImage: "record.circle")
            }
            .buttonStyle(BotaoOuro())
            .accessibilityLabel("Continuar gravando")
            Button("Encerrar e enviar") { stop() }
                .buttonStyle(BotaoPlaca())
        }
    }

    @ViewBuilder
    private var statusText: some View {
        if isRecording {
            Text("Gravando. Pode bloquear a tela: continua gravando, e lá aparecem Pausar e Parar.")
                .font(.footnote).foregroundStyle(.white.opacity(0.55)).multilineTextAlignment(.center)
        } else if terminou && !auth.emDemonstracao {
            VStack(spacing: 8) {
                Text("Pronto! A reunião aparece em Reuniões em alguns minutos.")
                    .font(.subheadline).foregroundStyle(.white.opacity(0.85)).multilineTextAlignment(.center)
                Button("Ver minhas reuniões") { verReunioes() }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Estilo.ouro)
            }
        } else if terminou {
            Text("Demonstração: a gravação ficou só neste iPhone e foi apagada.")
                .font(.footnote).foregroundStyle(.white.opacity(0.55)).multilineTextAlignment(.center)
        } else if recorder.state == .idle {
            VStack(spacing: 8) {
                Text("Toque para gravar a reunião.")
                    .font(.subheadline).foregroundStyle(.white.opacity(0.6))
                if !auth.emDemonstracao {
                    Button { mostrarGuia = true } label: {
                        Label("Gravar sem desbloquear o iPhone", systemImage: "lock.fill")
                    }
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Estilo.ouro)
                }
            }
        }
    }

    @ViewBuilder
    private var envioText: some View {
        if queue.precisaEntrar {
            Text("Seu acesso venceu. Entre de novo em Ajustes para enviar o que foi gravado.")
                .font(.footnote).foregroundStyle(Estilo.ouro).multilineTextAlignment(.center)
        } else if let erro = queue.gravacoes.compactMap(\.erro).first {
            Text(erro).font(.footnote).foregroundStyle(Estilo.ouro).multilineTextAlignment(.center)
        } else {
            let faltando = queue.gravacoes.reduce(0) { $0 + $1.pedacosFaltando }
            if faltando > 0 && !auth.emDemonstracao {
                Text(faltando == 1 ? "1 parte subindo." : "\(faltando) partes subindo.")
                    .font(.footnote).foregroundStyle(.white.opacity(0.5))
            }
        }
    }

    // MARK: - ações

    private var isRecording: Bool { recorder.state == .recording }

    private func toggleRecording() {
        if isRecording {
            stop()
        } else {
            Task { await start() }
        }
    }

    private func start() async {
        terminou = false
        let perm = recorder.currentPermission()
        if perm == .denied {
            permissionDenied = true
            return
        }
        if perm == .undetermined, !(await recorder.requestMicPermission()) {
            permissionDenied = true
            return
        }
        recorder.pedirPermissaoDeAviso()
        do {
            try ControleGravacao.shared.comecar()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func stop() {
        guard recorder.gravacaoId != nil else { return }
        ControleGravacao.shared.parar()
        terminou = true
    }

    private func openSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }

    private func formatElapsed(_ seconds: Double) -> String {
        let total = Int(seconds)
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%02d:%02d", m, s)
    }
}
