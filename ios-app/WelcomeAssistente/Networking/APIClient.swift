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
            return "Erro ao ler a resposta: \(e.localizedDescription)"
        case .network:
            return "Sem internet. Tente de novo."
        }
    }
}

// MARK: - Wire types

struct UsuarioRemoto: Codable, Equatable {
    let id: String
    let nome: String
    let email: String?
    let consent_terms_at: String?
}

struct EntrarResposta: Codable {
    let access_token: String
    let user: UsuarioRemoto
}

private struct EuResposta: Codable {
    let user: UsuarioRemoto
}

/// Endereços que o servidor informa antes do login (o TTARS e a chave pública dele).
struct ConfigRemota: Codable {
    let ttars_url: String
    let ttars_chave_publica: String
    let esqueci_senha_url: String
    let termos_url: String
}

private struct TokenTtars: Codable {
    let access_token: String
}

private struct ErroTtars: Codable {
    let error_code: String?
    let code: String?
}

private struct EnderecoResposta: Codable {
    let url: String
}

/// Erros do login com mensagem pronta para a tela.
enum ErroDeEntrada: Error, LocalizedError {
    case senhaErrada
    case emailNaoConfirmado
    case naoLiberado
    case muitasTentativas
    case semInternet
    case outro

    var errorDescription: String? {
        switch self {
        case .senhaErrada: return "E-mail ou senha errados. Use os mesmos do TTARS."
        case .emailNaoConfirmado: return "Confirme seu e-mail no TTARS antes de entrar."
        case .naoLiberado: return "Seu acesso ao Ações ainda não foi liberado. Peça ao Vitor."
        case .muitasTentativas: return "Muitas tentativas. Espere 1 minuto e tente de novo."
        case .semInternet: return "Sem internet. Tente de novo."
        case .outro: return "Não consegui entrar agora. Tente de novo em instantes."
        }
    }
}

// MARK: - Client

final class APIClient: @unchecked Sendable {
    static let shared = APIClient()

    private let session: URLSession
    private let decoder = JSONDecoder()

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 120
        self.session = URLSession(configuration: config)
    }

    // MARK: Entrar

    func configRemota() async throws -> ConfigRemota {
        var request = URLRequest(url: Configuration.baseURL.appendingPathComponent("/api/mobile/config"))
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return try await perform(request)
    }

    /// E-mail e senha vão direto para o TTARS; o Ações só recebe o token de volta.
    func entrarComTtars(email: String, senha: String) async throws -> EntrarResposta {
        let config: ConfigRemota
        do {
            config = try await configRemota()
        } catch APIError.network {
            throw ErroDeEntrada.semInternet
        } catch {
            throw ErroDeEntrada.outro
        }
        guard let urlTtars = URL(string: config.ttars_url + "/auth/v1/token?grant_type=password") else {
            throw ErroDeEntrada.outro
        }
        var pedido = URLRequest(url: urlTtars)
        pedido.httpMethod = "POST"
        pedido.setValue("application/json", forHTTPHeaderField: "Content-Type")
        pedido.setValue(config.ttars_chave_publica, forHTTPHeaderField: "apikey")
        pedido.httpBody = try JSONSerialization.data(withJSONObject: ["email": email, "password": senha])

        let (dados, resposta) = try await dadosOuSemInternet(pedido)
        guard let http = resposta as? HTTPURLResponse else { throw ErroDeEntrada.outro }
        guard (200..<300).contains(http.statusCode) else {
            let erro = try? decoder.decode(ErroTtars.self, from: dados)
            switch erro?.error_code ?? erro?.code ?? "" {
            case "invalid_credentials": throw ErroDeEntrada.senhaErrada
            case "email_not_confirmed": throw ErroDeEntrada.emailNaoConfirmado
            default: throw http.statusCode == 429 ? ErroDeEntrada.muitasTentativas : ErroDeEntrada.senhaErrada
            }
        }
        guard let token = try? decoder.decode(TokenTtars.self, from: dados) else { throw ErroDeEntrada.outro }

        var entrar = URLRequest(url: Configuration.baseURL.appendingPathComponent("/api/mobile/entrar"))
        entrar.httpMethod = "POST"
        entrar.setValue("Bearer \(token.access_token)", forHTTPHeaderField: "Authorization")
        entrar.setValue("application/json", forHTTPHeaderField: "Accept")
        let (corpo, resp) = try await dadosOuSemInternet(entrar)
        guard let r = resp as? HTTPURLResponse else { throw ErroDeEntrada.outro }
        switch r.statusCode {
        case 200..<300:
            guard let ok = try? decoder.decode(EntrarResposta.self, from: corpo) else { throw ErroDeEntrada.outro }
            return ok
        case 403: throw ErroDeEntrada.naoLiberado
        case 429: throw ErroDeEntrada.muitasTentativas
        case 401: throw ErroDeEntrada.senhaErrada
        default:
            throw ErroDeEntrada.outro
        }
    }

    /// Confere se o acesso deste aparelho ainda vale. 401 = precisa entrar de novo.
    func eu(token: String) async throws -> UsuarioRemoto {
        var request = URLRequest(url: Configuration.baseURL.appendingPathComponent("/api/mobile/eu"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let resposta: EuResposta = try await perform(request)
        return resposta.user
    }

    func sair(token: String) async {
        var request = URLRequest(url: Configuration.baseURL.appendingPathComponent("/api/mobile/sair"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        _ = try? await session.data(for: request)
    }

    /// Endereço de uso único que abre o site já logado (vale 2 minutos).
    func enderecoDoSite(token: String, para caminho: String = "/") async throws -> URL {
        var request = URLRequest(url: Configuration.baseURL.appendingPathComponent("/api/mobile/abrir"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["para": caminho])
        let resposta: EnderecoResposta = try await perform(request)
        guard let url = URL(string: resposta.url) else { throw APIError.invalidResponse }
        return url
    }

    // MARK: Reuniões

    func listMeetings(token: String, limit: Int = 30) async throws -> [Meeting] {
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

    // Os pedaços de áudio sobem pelo BackgroundUploader (continua com a tela bloqueada).

    // MARK: private

    private func dadosOuSemInternet(_ request: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await session.data(for: request)
        } catch {
            throw ErroDeEntrada.semInternet
        }
    }

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
}

struct MeetingsWrapper: Decodable {
    let meetings: [Meeting]
}
