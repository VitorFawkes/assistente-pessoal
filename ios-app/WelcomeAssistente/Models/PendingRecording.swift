import Foundation

/// Representa um áudio gravado localmente que ainda não foi confirmado pelo servidor.
/// Persistido em <Documents>/pending/<id>.json. O arquivo de áudio fica ao lado:
/// <Documents>/pending/<id>.m4a.
struct PendingRecording: Codable, Identifiable, Equatable {
    let id: String                // UUID
    let recordedAt: Date
    let durationSeconds: Double
    let originalFilename: String  // "mic - 20260528 1432.m4a"
    var status: Status
    var lastError: String?
    var attempts: Int

    enum Status: String, Codable {
        case pending     // ainda não tentou
        case uploading   // tentando agora
        case uploaded    // ingest-svc aceitou
        case failed      // erro permanente — esperando retry
    }

    func audioURL(in pendingDir: URL) -> URL {
        pendingDir.appendingPathComponent("\(id).m4a")
    }

    func metaURL(in pendingDir: URL) -> URL {
        pendingDir.appendingPathComponent("\(id).json")
    }
}
