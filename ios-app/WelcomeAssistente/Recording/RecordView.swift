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

    var body: some View {
        NavigationStack {
            VStack(spacing: 28) {
                if auth.emDemonstracao {
                    Text("Demonstração: nada é enviado.")
                        .font(.footnote)
                        .padding(8)
                        .frame(maxWidth: .infinity)
                        .background(Color.orange.opacity(0.15))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                Spacer()
                timerLabel
                meterBar
                if recorder.state == .interrompido {
                    interrompido
                } else {
                    recordButton
                }
                Spacer()
                statusText
                envioText
                Spacer()
            }
            .padding()
            .navigationTitle("Ações")
            .alert("Microfone bloqueado", isPresented: $permissionDenied) {
                Button("Abrir Ajustes") { openSettings() }
                Button("Cancelar", role: .cancel) {}
            } message: {
                Text("Para gravar reuniões, ligue o microfone em Ajustes → Ações.")
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

    private var timerLabel: some View {
        Text(formatElapsed(recorder.elapsedSeconds))
            .font(.system(size: 56, weight: .light, design: .rounded))
            .monospacedDigit()
            .foregroundStyle(isRecording ? Color.red : Color.primary)
            .contentTransition(.numericText())
    }

    private var meterBar: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 4).fill(Color.secondary.opacity(0.15))
                RoundedRectangle(cornerRadius: 4)
                    .fill(isRecording ? Color.red : Color.gray)
                    .frame(width: geo.size.width * recorder.meterLevel)
                    .animation(.linear(duration: 0.1), value: recorder.meterLevel)
            }
        }
        .frame(height: 6)
        .padding(.horizontal, 40)
        .opacity(isRecording ? 1 : 0.3)
    }

    private var recordButton: some View {
        Button(action: toggleRecording) {
            ZStack {
                Circle()
                    .fill(isRecording ? Color.red : Color.accentColor)
                    .frame(width: 140, height: 140)
                    .shadow(radius: isRecording ? 12 : 6)
                if isRecording {
                    RoundedRectangle(cornerRadius: 8).fill(Color.white).frame(width: 40, height: 40)
                } else {
                    Image(systemName: "mic.fill").font(.system(size: 54)).foregroundStyle(.white)
                }
            }
            .scaleEffect(isRecording ? 1.05 : 1.0)
            .animation(.spring(duration: 0.3), value: isRecording)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isRecording ? "Parar a gravação" : "Começar a gravar")
    }

    private var interrompido: some View {
        VStack(spacing: 14) {
            Text("A gravação parou (ligação ou outro app usou o microfone). O que foi gravado está salvo.")
                .font(.subheadline)
                .multilineTextAlignment(.center)
            Button {
                do {
                    try recorder.continuar()
                } catch {
                    errorMessage = error.localizedDescription
                }
            } label: {
                Text("Continuar gravando").fontWeight(.semibold)
                    .frame(maxWidth: .infinity).padding(.vertical, 14)
                    .background(Color.red).foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            Button("Encerrar e enviar") { stop() }
        }
        .padding(.horizontal)
    }

    @ViewBuilder
    private var statusText: some View {
        if isRecording {
            Text("Gravando. Pode bloquear a tela, continua gravando.")
                .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
        } else if terminou && !auth.emDemonstracao {
            VStack(spacing: 10) {
                Text("Pronto! A reunião aparece no Ações em alguns minutos.")
                    .font(.subheadline).multilineTextAlignment(.center)
                Button("Ver minhas reuniões") { verReunioes() }
            }
        } else if terminou {
            Text("Demonstração: a gravação ficou só neste iPhone e foi apagada.")
                .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
        } else if recorder.state == .idle {
            Text("Toque para gravar a reunião.")
                .font(.subheadline).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var envioText: some View {
        if queue.precisaEntrar {
            Text("Seu acesso venceu. Entre de novo em Ajustes para enviar o que foi gravado.")
                .font(.footnote).foregroundStyle(.orange).multilineTextAlignment(.center)
        } else if let erro = queue.gravacoes.compactMap(\.erro).first {
            Text(erro).font(.footnote).foregroundStyle(.orange).multilineTextAlignment(.center)
        } else {
            let faltando = queue.gravacoes.reduce(0) { $0 + $1.pedacosFaltando }
            if faltando > 0 && !auth.emDemonstracao {
                Text(faltando == 1 ? "1 parte subindo." : "\(faltando) partes subindo.")
                    .font(.footnote).foregroundStyle(.secondary)
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
            let id = try queue.novaGravacao(donoId: auth.currentUser?.id)
            do {
                try recorder.iniciar(gravacaoId: id)
            } catch {
                queue.descartar(gravacaoId: id)
                throw error
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func stop() {
        guard let id = recorder.gravacaoId else { return }
        let duracao = recorder.parar()
        if auth.emDemonstracao {
            queue.descartar(gravacaoId: id)
        } else {
            queue.encerrar(gravacaoId: id, duracao: duracao)
        }
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
