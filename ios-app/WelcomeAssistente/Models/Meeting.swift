import Foundation

struct Meeting: Identifiable, Decodable, Equatable, Hashable {
    let id: String
    let recorded_at: String?
    let status: Status
    let raw_status: String?
    let summary: String?
    let duration_seconds: Double?
    let source: String?
    let meeting_type: String?
    let tarefas_count: Int?
    let web_url: String?

    enum Status: String, Decodable {
        case processing
        case ready
        case failed
        case archived
    }

    var webURL: URL? {
        web_url.flatMap(URL.init(string:))
    }

    var recordedAtDate: Date? {
        guard let raw = recorded_at else { return nil }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime]
        if let d = iso.date(from: raw) { return d }
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return iso.date(from: raw)
    }

    var formattedDuration: String {
        guard let s = duration_seconds, s > 0 else { return "—" }
        let total = Int(s)
        let h = total / 3600
        let m = (total % 3600) / 60
        let sec = total % 60
        if h > 0 { return String(format: "%dh %02dm", h, m) }
        if m > 0 { return String(format: "%dm %02ds", m, sec) }
        return "\(sec)s"
    }
}
