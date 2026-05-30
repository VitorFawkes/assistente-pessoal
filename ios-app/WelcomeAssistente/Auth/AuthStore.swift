import Foundation
import Observation

@Observable
@MainActor
final class AuthStore {
    enum State: Equatable {
        case checking
        case unauthenticated
        case authenticated(user: AuthenticatedUser)
    }

    struct AuthenticatedUser: Equatable, Codable {
        let id: String
        let nome: String
        let email: String?
        let token: String
        let consentTermsAt: String?
    }

    private(set) var state: State = .checking
    /// Quando o app recebe um Universal Link com /c/CODE, guarda o código aqui
    /// pra Onboarding pré-preencher o campo.
    var pendingInviteCode: String?

    var sessionToken: String? {
        if case .authenticated(let user) = state { return user.token }
        return nil
    }

    var currentUser: AuthenticatedUser? {
        if case .authenticated(let user) = state { return user }
        return nil
    }

    // MARK: - Restore from Keychain

    func restoreFromKeychain() async {
        guard let token = KeychainStorage.get(.sessionToken) else {
            state = .unauthenticated
            return
        }
        // Re-valida no servidor — se inválido/expirado/revogado, volta pra onboarding.
        do {
            let resp = try await APIClient.shared.exchange(.refresh(token: token))
            persist(resp)
        } catch {
            KeychainStorage.clearAll()
            state = .unauthenticated
        }
    }

    // MARK: - Login by invite

    func loginWithInvite(code: String, nome: String) async throws {
        let resp = try await APIClient.shared.exchange(
            .invite(code: code, nome: nome)
        )
        persist(resp)
    }

    // MARK: - Logout

    func logoutLocal() {
        KeychainStorage.clearAll()
        state = .unauthenticated
    }

    func logoutAllDevices() async {
        if let token = sessionToken {
            _ = try? await APIClient.shared.revokeAllSessions(token: token)
        }
        logoutLocal()
    }

    // MARK: - Universal Link handler

    /// Chamado pelo @main App quando iOS entrega https://acoes.../c/CODE.
    /// Path esperado: /c/<CODE>
    func handleIncomingURL(_ url: URL) {
        let parts = url.pathComponents
        guard parts.count >= 3, parts[1] == "c" else { return }
        let code = parts[2]
        if code.isEmpty { return }
        pendingInviteCode = code
    }

    // MARK: - private

    private func persist(_ resp: ExchangeResponse) {
        let user = AuthenticatedUser(
            id: resp.user.id,
            nome: resp.user.nome,
            email: resp.user.email,
            token: resp.access_token,
            consentTermsAt: resp.user.consent_terms_at
        )
        KeychainStorage.set(user.token, for: .sessionToken)
        KeychainStorage.set(user.id, for: .userId)
        KeychainStorage.set(user.nome, for: .userName)
        KeychainStorage.set(user.email, for: .userEmail)
        state = .authenticated(user: user)
        pendingInviteCode = nil
    }
}
