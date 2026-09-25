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

    // MARK: - Abrir o app

    /// Entra direto com o acesso guardado; confere no servidor em seguida.
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
        guard let token = KeychainStorage.get(.sessionToken),
              let id = KeychainStorage.get(.userId) else {
            state = .unauthenticated
            await carregarConfig()
            return
        }
        state = .authenticated(user: AuthenticatedUser(
            id: id,
            nome: KeychainStorage.get(.userName) ?? "",
            email: KeychainStorage.get(.userEmail),
            token: token
        ))
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
