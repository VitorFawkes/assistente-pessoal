import Foundation
import Observation

/// Fila persistente de uploads. Cada gravação tem um par <id>.m4a + <id>.json
/// em <Documents>/pending. Após upload bem-sucedido, ambos são removidos.
///
/// O envio usa `BackgroundUploader` (background URLSession): sobrevive à suspensão
/// do app e a relançamentos, essencial pra gravações grandes (centenas de MB). O
/// servidor responde 202 assim que recebe os bytes — qualquer 2xx marca `.uploaded`
/// e apaga o local, sem re-enviar (evita transcrição duplicada).
@Observable
@MainActor
final class UploadQueue {
    private(set) var items: [PendingRecording] = []
    private(set) var isProcessing = false

    private let fm = FileManager.default
    private let decoder = JSONDecoder()
    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.outputFormatting = [.prettyPrinted, .sortedKeys]
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    init() {
        decoder.dateDecodingStrategy = .iso8601
        items = loadFromDisk()
        // Re-anexa a sessão de background às tasks em voo (após relançamento) e
        // registra o callback de conclusão.
        BackgroundUploader.shared.activate()
        BackgroundUploader.shared.onComplete = { [weak self] id, success, status, message in
            Task { @MainActor in
                self?.handleCompletion(id: id, success: success, status: status, message: message)
            }
        }
    }

    // MARK: - enqueue

    /// Cria um PendingRecording a partir de uma gravação que já está em pendingDir.
    /// `audioURL` deve ser o arquivo .m4a real (já gravado).
    @discardableResult
    func enqueue(audioURL: URL, recordedAt: Date, duration: Double) throws -> PendingRecording {
        let id = audioURL.deletingPathExtension().lastPathComponent
        let stamp = filenameTimestamp(from: recordedAt)
        let originalFilename = "mic - \(stamp).m4a"
        let rec = PendingRecording(
            id: id,
            recordedAt: recordedAt,
            durationSeconds: duration,
            originalFilename: originalFilename,
            status: .pending,
            lastError: nil,
            attempts: 0
        )
        let metaURL = rec.metaURL(in: AudioRecorder.pendingDirectoryURL)
        try encoder.encode(rec).write(to: metaURL, options: .atomic)
        items.insert(rec, at: 0)
        return rec
    }

    // MARK: - process pending uploads

    func processPending(authStore: AuthStore) async {
        guard !isProcessing else { return }
        guard let token = authStore.sessionToken else { return }
        isProcessing = true
        defer { isProcessing = false }

        // IDs já em transferência na background session (sobreviveram a relançamento).
        let inflight = await BackgroundUploader.shared.inflightRecordingIds()

        let snapshot = items
        for rec in snapshot {
            if inflight.contains(rec.id) {
                // Já está subindo — só sincroniza o estado, não re-envia.
                if rec.status != .uploading {
                    update(rec.id) { $0.status = .uploading }
                }
                continue
            }
            // Auto-envia só o que nunca foi tentado. `.failed` exige retry manual
            // e `.uploading`-sem-task pode ter concluído server-side (o delegate
            // resolve) — re-enviar qualquer um desses arriscaria duplicar a reunião.
            if rec.status == .pending {
                startUpload(rec, token: token)
            }
        }
    }

    /// Retry manual de um item específico.
    func retry(_ rec: PendingRecording, authStore: AuthStore) async {
        guard let token = authStore.sessionToken else { return }
        let inflight = await BackgroundUploader.shared.inflightRecordingIds()
        guard !inflight.contains(rec.id) else { return }
        startUpload(rec, token: token)
    }

    // MARK: - delete (cancela um pendente)

    func delete(_ rec: PendingRecording) {
        let dir = AudioRecorder.pendingDirectoryURL
        try? fm.removeItem(at: rec.audioURL(in: dir))
        try? fm.removeItem(at: rec.metaURL(in: dir))
        try? fm.removeItem(at: bodyFileURL(for: rec.id))
        items.removeAll { $0.id == rec.id }
    }

    // MARK: - private

    private func startUpload(_ rec: PendingRecording, token: String) {
        update(rec.id) { $0.status = .uploading; $0.attempts += 1; $0.lastError = nil }
        let dir = AudioRecorder.pendingDirectoryURL
        let audioURL = rec.audioURL(in: dir)
        guard fm.fileExists(atPath: audioURL.path) else {
            update(rec.id) { $0.status = .failed; $0.lastError = "arquivo de áudio sumiu" }
            return
        }

        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime]

        do {
            try BackgroundUploader.shared.upload(
                recordingId: rec.id,
                audioURL: audioURL,
                bodyFileURL: bodyFileURL(for: rec.id),
                to: Configuration.ingestURL.appendingPathComponent("/upload"),
                authToken: token,
                fields: [
                    "recorded_at": iso.string(from: rec.recordedAt),
                    "original_filename": rec.originalFilename,
                    "source": "ios-app",
                    "meeting_type": "presencial",
                ],
                filename: rec.originalFilename
            )
        } catch {
            update(rec.id) {
                $0.status = .failed
                $0.lastError = "falha ao preparar upload: \(error.localizedDescription)"
            }
        }
    }

    /// Chamado pelo BackgroundUploader quando a transferência conclui (qualquer 2xx
    /// = sucesso; o ingest-svc já respondeu 202 e processa em background).
    private func handleCompletion(id: String, success: Bool, status: Int, message: String?) {
        try? fm.removeItem(at: bodyFileURL(for: id))
        let dir = AudioRecorder.pendingDirectoryURL
        if success {
            if let rec = items.first(where: { $0.id == id }) {
                try? fm.removeItem(at: rec.audioURL(in: dir))
                try? fm.removeItem(at: rec.metaURL(in: dir))
            }
            items.removeAll { $0.id == id }
        } else {
            update(id) {
                $0.status = .failed
                $0.lastError = message ?? "falha no upload (status \(status))"
            }
        }
    }

    /// Arquivo temporário do corpo multipart (montado por streaming). Fora de
    /// /pending pra não ser confundido com áudio/meta pelo loadFromDisk.
    private func bodyFileURL(for id: String) -> URL {
        fm.temporaryDirectory.appendingPathComponent("upload-\(id).multipart")
    }

    private func update(_ id: String, _ mutate: (inout PendingRecording) -> Void) {
        guard let idx = items.firstIndex(where: { $0.id == id }) else { return }
        var item = items[idx]
        mutate(&item)
        items[idx] = item
        let dir = AudioRecorder.pendingDirectoryURL
        try? encoder.encode(item).write(to: item.metaURL(in: dir), options: .atomic)
    }

    private func loadFromDisk() -> [PendingRecording] {
        let dir = AudioRecorder.pendingDirectoryURL
        guard let urls = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else {
            return []
        }
        return urls
            .filter { $0.pathExtension == "json" }
            .compactMap { url -> PendingRecording? in
                guard let data = try? Data(contentsOf: url) else { return nil }
                return try? decoder.decode(PendingRecording.self, from: data)
            }
            .sorted { $0.recordedAt > $1.recordedAt }
    }

    private func filenameTimestamp(from date: Date) -> String {
        let df = DateFormatter()
        df.dateFormat = "yyyyMMdd HHmm"
        df.locale = Locale(identifier: "en_US_POSIX")
        return df.string(from: date)
    }
}
