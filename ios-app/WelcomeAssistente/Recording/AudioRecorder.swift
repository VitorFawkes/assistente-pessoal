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
        try session.setCategory(.playAndRecord,
                                mode: .default,
                                options: [.allowBluetooth, .defaultToSpeaker])
        try session.setActive(true)

        let pendingDir = try ensurePendingDir()
        let id = UUID().uuidString
        let url = pendingDir.appendingPathComponent("\(id).m4a")

        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 16000.0,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 64000,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]

        let rec = try AVAudioRecorder(url: url, settings: settings)
        rec.delegate = self
        rec.isMeteringEnabled = true
        guard rec.record() else {
            throw NSError(
                domain: "AudioRecorder",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Falha ao iniciar gravação"]
            )
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
