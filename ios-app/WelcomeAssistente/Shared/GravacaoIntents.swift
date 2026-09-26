import AppIntents

// Botões da tela bloqueada, da Atividade ao Vivo, do botão de Ação e da Siri.
// O iOS roda estes pedidos dentro do app (abre o app escondido se precisar);
// a extensão só conhece os tipos para montar os botões — por isso o #if.
// Todos: sem pedir desbloqueio e sempre no app (a extensão não grava).

/// Botão da tela bloqueada e do botão de Ação: grava; se já grava, pausa; se pausado, continua.
struct GravarOuPausarIntent: AudioRecordingIntent, LiveActivityIntent {
    static let title: LocalizedStringResource = "Gravar ou pausar reunião"
    static let description = IntentDescription("Começa a gravar. Se já estiver gravando, pausa. Se estiver pausada, continua.")
    static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
    /// Escondido; se o iPhone não deixar gravar assim, abre o Ações e grava lá.
    @available(iOS 26.0, *)
    static var supportedModes: IntentModes { [.background, .foreground(.dynamic)] }
    @available(iOS 27.0, *)
    static var allowedExecutionTargets: IntentExecutionTargets { .main }

    @MainActor
    func perform() async throws -> some IntentResult {
        #if !WIDGET
        try await gravarSemAbrir(self) { try $0.gravarOuPausar() }
        #endif
        return .result()
    }
}

/// Gravar (ou continuar a pausada).
struct GravarReuniaoIntent: AudioRecordingIntent, LiveActivityIntent {
    static let title: LocalizedStringResource = "Gravar reunião"
    static let description = IntentDescription("Começa a gravar a reunião, ou continua a gravação pausada.")
    static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
    @available(iOS 26.0, *)
    static var supportedModes: IntentModes { [.background, .foreground(.dynamic)] }
    @available(iOS 27.0, *)
    static var allowedExecutionTargets: IntentExecutionTargets { .main }

    @MainActor
    func perform() async throws -> some IntentResult {
        #if !WIDGET
        try await gravarSemAbrir(self) { try $0.gravarOuContinuar() }
        #endif
        return .result()
    }
}

struct PausarGravacaoIntent: AudioRecordingIntent, LiveActivityIntent {
    static let title: LocalizedStringResource = "Pausar gravação"
    static let description = IntentDescription("Pausa a gravação. O que já foi gravado fica guardado.")
    static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
    @available(iOS 26.0, *)
    static var supportedModes: IntentModes { .background }
    @available(iOS 27.0, *)
    static var allowedExecutionTargets: IntentExecutionTargets { .main }

    @MainActor
    func perform() async throws -> some IntentResult {
        #if !WIDGET
        Registro.anotar("pedido pausar")
        ControleGravacao.shared.pausar()
        #endif
        return .result()
    }
}

struct PararGravacaoIntent: AudioRecordingIntent, LiveActivityIntent {
    static let title: LocalizedStringResource = "Parar gravação"
    static let description = IntentDescription("Termina a gravação e envia a reunião para o Ações.")
    static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
    @available(iOS 26.0, *)
    static var supportedModes: IntentModes { .background }
    @available(iOS 27.0, *)
    static var allowedExecutionTargets: IntentExecutionTargets { .main }

    @MainActor
    func perform() async throws -> some IntentResult {
        #if !WIDGET
        Registro.anotar("pedido parar")
        ControleGravacao.shared.parar()
        #endif
        return .result()
    }
}

#if !WIDGET
// Até o iOS 25 o pedido de abrir o app vem daqui. (Só no app: a extensão não pode abrir o app.)
extension GravarOuPausarIntent: ForegroundContinuableIntent {}
extension GravarReuniaoIntent: ForegroundContinuableIntent {}

/// Grava sem abrir a tela. Sem conta ou sem microfone liberado: o iOS pede para abrir o Ações.
/// Se o iPhone não deixar gravar escondido (sem o aviso da tela bloqueada): abre o Ações e grava lá.
@MainActor
private func gravarSemAbrir<Pedido: ForegroundContinuableIntent>(
    _ pedido: Pedido,
    _ acao: @escaping @MainActor (ControleGravacao) throws -> Void
) async throws {
    let controle = ControleGravacao.shared
    do {
        try acao(controle)
    } catch let erro as ControleGravacao.Erro {
        Registro.anotar("pedido precisa do app aberto: \(erro)")
        let aviso = IntentDialog(stringLiteral: erro.errorDescription ?? "")
        if #available(iOS 26.0, *) {
            guard erro.gravaComAppAberto else { throw pedido.needsToContinueInForegroundError(aviso, alwaysConfirm: true) }
            try await pedido.continueInForeground(aviso, alwaysConfirm: true)
            try acao(controle)
        } else {
            throw pedido.needsToContinueInForegroundError(aviso, continuation: erro.gravaComAppAberto ? { try acao(controle) } : nil)
        }
    }
}
#endif
