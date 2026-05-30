import Foundation

enum APIError: Error, LocalizedError {
    case http(status: Int, body: String)
    case invalidResponse
    case decoding(Error)
    case network(Error)

    var errorDescription: String? {
        switch self {
        case .http(let status, let body):
            return "Erro \(status): \(body.prefix(140))"
        case .invalidResponse:
            return "Resposta inválida do servidor"
        case .decoding(let e):
            return "Erro ao decodificar resposta: \(e.localizedDescription)"
        case .network(let e):
            return "Erro de rede: \(e.localizedDescription)"
        }
    }
}

// MARK: - Wire types

struct ExchangePayload: Codable {
    let id: String
    let nome: String
    let email: String?
    let whatsapp: String?
    let is_admin: Bool
    let consent_terms_at: String?
}

struct ExchangeResponse: Codable {
    let access_token: String
    let user: ExchangePayload
}

enum ExchangeRequest {
    case invite(code: String, nome: String)
    case refresh(token: String)
}

// MARK: - Client

final class APIClient: @unchecked Sendable {
    static let shared = APIClient()

    private let session: URLSession
    private let decoder: JSONDecoder

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 120
        self.session = URLSession(configuration: config)
        self.decoder = JSONDecoder()
    }

    // MARK: Auth

    func exchange(_ req: ExchangeRequest) async throws -> ExchangeResponse {
        let url = Configuration.baseURL.appendingPathComponent("/api/auth/mobile/exchange")
        let body: [String: String]
        switch req {
        case .invite(let code, let nome):
            body = ["invite_code": code, "nome": nome]
        case .refresh(let token):
            body = ["session_token": token]
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await perform(request)
    }

    func revokeAllSessions(token: String) async throws {
        let url = Configuration.baseURL.appendingPathComponent("/api/mobile/sessao/revoke-all")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        _ = try await perform204(request)
    }

    // MARK: Meetings

    func listMeetings(token: String, limit: Int = 20) async throws -> [Meeting] {
        var comps = URLComponents(
            url: Configuration.baseURL.appendingPathComponent("/api/mobile/meetings"),
            resolvingAgainstBaseURL: false
        )!
        comps.queryItems = [URLQueryItem(name: "limit", value: String(limit))]
        var request = URLRequest(url: comps.url!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let wrapper: MeetingsWrapper = try await perform(request)
        return wrapper.meetings
    }

    // Upload de áudio agora é feito via BackgroundUploader (background URLSession),
    // não por este client — sobrevive à suspensão do app em gravações grandes.

    // MARK: private

    private func perform<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.network(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            let s = String(data: data, encoding: .utf8) ?? ""
            throw APIError.http(status: http.statusCode, body: s)
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }

    private func perform204(_ request: URLRequest) async throws {
        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.http(status: http.statusCode, body: "")
        }
    }

}

struct MeetingsWrapper: Decodable {
    let meetings: [Meeting]
}
