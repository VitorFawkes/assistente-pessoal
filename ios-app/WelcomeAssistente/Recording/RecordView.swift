import SwiftUI
import AVFoundation

struct RecordView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(UploadQueue.self) private var queue
    @State private var recorder = AudioRecorder()
    @State private var permissionDenied = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 32) {
                Spacer()
                timerLabel
                meterBar
                recordButton
                Spacer()
                statusText
                Spacer()
            }
            .padding()
            .navigationTitle("Welcome")
            .alert("Microfone bloqueado",
                   isPresented: $permissionDenied) {
                Button("Abrir Ajustes") { openSettings() }
                Button("Cancelar", role: .cancel) {}
            } message: {
                Text("Pra gravar reuniões, ative o microfone em Ajustes → Welcome.")
            }
            .alert("Erro",
                   isPresented: Binding(
                       get: { errorMessage != nil },
                       set: { if !$0 { errorMessage = nil } }
                   )) {
                Button("OK") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    // MARK: - Subviews

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
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color.secondary.opacity(0.15))
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
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color.white)
                        .frame(width: 40, height: 40)
                } else {
                    Image(systemName: "mic.fill")
                        .font(.system(size: 54))
                        .foregroundStyle(.white)
                }
            }
            .scaleEffect(isRecording ? 1.05 : 1.0)
            .animation(.spring(duration: 0.3), value: isRecording)
        }
        .buttonStyle(.plain)
        .disabled(recorder.state == .stopping)
    }

    private var statusText: some View {
        Text(isRecording
             ? "Gravando — toque pra parar"
             : "Toque pra começar")
            .font(.subheadline)
            .foregroundStyle(.secondary)
    }

    // MARK: - Actions

    private var isRecording: Bool {
        if case .recording = recorder.state { return true }
        return false
    }

    private func toggleRecording() {
        if isRecording {
            stop()
        } else {
            Task { await start() }
        }
    }

    private func start() async {
        let perm = recorder.currentPermission()
        if perm == .denied {
            permissionDenied = true
            return
        }
        if perm == .undetermined {
            let granted = await recorder.requestMicPermission()
            if !granted {
                permissionDenied = true
                return
            }
        }
        do {
            try await recorder.start()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func stop() {
        guard let result = recorder.stop() else { return }
        let recordedAt = Date().addingTimeInterval(-result.duration)
        do {
            _ = try queue.enqueue(
                audioURL: result.url,
                recordedAt: recordedAt,
                duration: result.duration
            )
            Task { await queue.processPending(authStore: auth) }
        } catch {
            errorMessage = "Não consegui salvar a gravação: \(error.localizedDescription)"
        }
    }

    private func openSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }

    private func formatElapsed(_ seconds: Double) -> String {
        let total = Int(seconds)
        let h = total / 3600
        let m = (total % 3600) / 60
        let s = total % 60
        if h > 0 {
            return String(format: "%d:%02d:%02d", h, m, s)
        }
        return String(format: "%02d:%02d", m, s)
    }
}
