import AVFoundation
import Foundation
import Observation

@Observable
@MainActor
final class AudioRecorder: NSObject {
    enum State: Equatable {
        case idle
        case recording(startedAt: Date)
        case stopping
    }

    private(set) var state: State = .idle
    private(set) var meterLevel: Double = 0    // 0...1
    private(set) var elapsedSeconds: Double = 0

    private var recorder: AVAudioRecorder?
    private var meterTimer: Timer?
    private var currentURL: URL?

    /// Pede permissão de microfone (iOS 17+ API).
    func requestMicPermission() async -> Bool {
        await withCheckedContinuation { cont in
            AVAudioApplication.requestRecordPermission { granted in
                cont.resume(returning: granted)
            }
        }
    }

    func currentPermission() -> AVAudioApplication.recordPermission {
        AVAudioApplication.shared.recordPermission
    }

    /// Inicia gravação em <Documents>/pending/<uuid>.m4a. Retorna URL ou throws.
    @discardableResult
    func start() async throws -> URL {
        let session = AVAudioSession.sharedInstance()

        // Config minimalista pra evitar incompatibilidades iOS 26:
        // - mode .default em vez de .spokenAudio (.spokenAudio rejeita em alguns hw)
        // - sem .duckOthers (interage com Now Playing system de forma errática)
        // - .defaultToSpeaker direciona playback apenas (não afeta input)
        do {
            try session.setCategory(.playAndRecord, mode: .default,
                                    options: [.defaultToSpeaker])
        } catch {
            throw NSError(domain: "AudioRecorder", code: -2,
                userInfo: [NSLocalizedDescriptionKey:
                    "setCategory falhou: \(error.localizedDescription)"])
        }
        do {
            try session.setActive(true)
        } catch {
            throw NSError(domain: "AudioRecorder", code: -3,
                userInfo: [NSLocalizedDescriptionKey:
                    "setActive falhou: \(error.localizedDescription) (categoria=\(session.category.rawValue), sampleRate=\(session.sampleRate))"])
        }

        let pendingDir = try ensurePendingDir()
        let id = UUID().uuidString
        let url = pendingDir.appendingPathComponent("\(id).m4a")

        // Sample rate 44100 é mais universal em hardware iOS — 16kHz nativo pode
        // ser rejeitado pelo AVAudioRecorder em alguns iPhones, exige resampling
        // manual. ingest-svc reencoda pra 16kHz no ffmpeg de qualquer jeito.
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44100.0,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 64000,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]

        let rec: AVAudioRecorder
        do {
            rec = try AVAudioRecorder(url: url, settings: settings)
        } catch {
            throw NSError(domain: "AudioRecorder", code: -4,
                userInfo: [NSLocalizedDescriptionKey:
                    "AVAudioRecorder init falhou: \(error.localizedDescription)"])
        }
        rec.delegate = self
        rec.isMeteringEnabled = true

        // Logging detalhado pra debug remoto via Xcode console
        let perm = AVAudioApplication.shared.recordPermission
        let route = session.currentRoute.inputs.map { "\($0.portName)(\($0.portType.rawValue))" }.joined(separator: ",")
        print("[Recorder] permission=\(perm.rawValue) inputs=[\(route)] cat=\(session.category.rawValue) mode=\(session.mode.rawValue)")

        if !rec.record() {
            let info: [String: Any] = [
                NSLocalizedDescriptionKey: "Gravação falhou. Permission=\(perm.rawValue), inputs=[\(route.isEmpty ? "nenhum" : route)]. Tente: feche outros apps que usam áudio (gravador, chamada, Spotify) e tente de novo.",
                "permission": perm.rawValue,
                "inputs": route,
                "category": session.category.rawValue,
                "mode": session.mode.rawValue
            ]
            throw NSError(domain: "AudioRecorder", code: -6, userInfo: info)
        }

        recorder = rec
        currentURL = url
        state = .recording(startedAt: Date())
        startMeter()
        return url
    }

    /// Para gravação e retorna URL + duração. Não move arquivo — só finaliza.
    @discardableResult
    func stop() -> (url: URL, duration: TimeInterval)? {
        guard let rec = recorder, let url = currentURL else { return nil }
        state = .stopping
        rec.stop()
        let duration = rec.currentTime
        stopMeter()
        recorder = nil
        currentURL = nil
        state = .idle
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        return (url, duration)
    }

    func cancel() {
        guard let rec = recorder, let url = currentURL else { return }
        rec.stop()
        try? FileManager.default.removeItem(at: url)
        stopMeter()
        recorder = nil
        currentURL = nil
        state = .idle
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    // MARK: - meter

    private func startMeter() {
        meterTimer?.invalidate()
        meterTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let rec = self.recorder else { return }
                rec.updateMeters()
                let avg = rec.averagePower(forChannel: 0)         // dB, -160...0
                // Mapeia -50dB...0dB → 0...1 (clamp)
                let clamped = max(-50, min(0, avg))
                self.meterLevel = Double((clamped + 50) / 50)
                if case .recording(let start) = self.state {
                    self.elapsedSeconds = Date().timeIntervalSince(start)
                }
            }
        }
    }

    private func stopMeter() {
        meterTimer?.invalidate()
        meterTimer = nil
        meterLevel = 0
        elapsedSeconds = 0
    }

    // MARK: - filesystem helpers

    static var pendingDirectoryURL: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return docs.appendingPathComponent("pending", isDirectory: true)
    }

    private func ensurePendingDir() throws -> URL {
        let dir = Self.pendingDirectoryURL
        if !FileManager.default.fileExists(atPath: dir.path) {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }
}

extension AudioRecorder: AVAudioRecorderDelegate {
    // Sem ação por enquanto — UploadQueue cuida da pós-gravação.
}
