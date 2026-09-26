import Foundation
import Observation

@Observable
@MainActor
final class AuthStore {
    enum State: Equatable {
        case checking
        case unauthenticated
        case authenticated(user: AuthenticatedUser)
        /// "Conhecer o app": grava no aparelho, não envia nada, sem conta.
        case demonstracao
    }

    struct AuthenticatedUser: Equatable, Codable {
        let id: String
        let nome: String
        let email: String?
        let token: String
    }

    private(set) var state: State = .checking
    private(set) var configRemota: ConfigRemota?

    var sessionToken: String? {
        if case .authenticated(let user) = state { return user.token }
        return nil
    }

    var currentUser: AuthenticatedUser? {
        if case .authenticated(let user) = state { return user }
        return nil
    }

    var emDemonstracao: Bool { state == .demonstracao }

    /// Já nasce entrado com o acesso guardado: o iOS pode abrir o app escondido
    /// para atender o botão da tela bloqueada, sem tela nenhuma.
    init() {
        #if DEBUG
        // Só em testes no simulador: começa sem conta (-semConta), mesmo que outro teste tenha entrado.
        if CommandLine.arguments.contains("-semConta") { KeychainStorage.clearAll() }
        #endif
        if let token = KeychainStorage.get(.sessionToken), let id = KeychainStorage.get(.userId) {
            state = .authenticated(user: AuthenticatedUser(
                id: id,
                nome: KeychainStorage.get(.userName) ?? "",
                email: KeychainStorage.get(.userEmail),
                token: token
            ))
        }
    }

    // MARK: - Abrir o app

    /// Confere no servidor o acesso guardado (401 = sai).
    /// Sem internet, continua entrado (a gravação não pode depender de rede).
    func restoreFromKeychain() async {
        #if DEBUG
        // Só em testes no simulador: entra com um acesso de conta de teste (-tokenDeTeste <token>).
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "-tokenDeTeste"), i + 1 < args.count,
           let remoto = try? await APIClient.shared.eu(token: args[i + 1]) {
            guardar(token: args[i + 1], usuario: remoto)
            return
        }
        #endif
        guard let token = sessionToken else {
            if state == .checking { state = .unauthenticated }
            await carregarConfig()
            return
        }
        do {
            let remoto = try await APIClient.shared.eu(token: token)
            guardar(token: token, usuario: remoto)
        } catch APIError.http(let status, _) where status == 401 {
            sairLocal()
        } catch {
            // Sem internet ou servidor fora: mantém o acesso guardado.
        }
    }

    func carregarConfig() async {
        if configRemota == nil {
            configRemota = try? await APIClient.shared.configRemota()
        }
    }

    // MARK: - Entrar

    func entrar(email: String, senha: String) async throws {
        let resposta = try await APIClient.shared.entrarComTtars(email: email, senha: senha)
        guardar(token: resposta.access_token, usuario: resposta.user)
    }

    func entrarNaDemonstracao() {
        state = .demonstracao
    }

    #if DEBUG
    /// Só em testes: entra com o acesso de uma conta de teste.
    func entrarParaTeste(token: String) async throws {
        guardar(token: token, usuario: try await APIClient.shared.eu(token: token))
    }
    #endif

    // MARK: - Sair

    func sairLocal() {
        KeychainStorage.clearAll()
        state = .unauthenticated
    }

    func sair() async {
        if let token = sessionToken {
            await APIClient.shared.sair(token: token)
        }
        sairLocal()
    }

    // MARK: - private

    private func guardar(token: String, usuario: UsuarioRemoto) {
        KeychainStorage.set(token, for: .sessionToken)
        KeychainStorage.set(usuario.id, for: .userId)
        KeychainStorage.set(usuario.nome, for: .userName)
        KeychainStorage.set(usuario.email, for: .userEmail)
        state = .authenticated(user: AuthenticatedUser(
            id: usuario.id, nome: usuario.nome, email: usuario.email, token: token
        ))
    }
}
