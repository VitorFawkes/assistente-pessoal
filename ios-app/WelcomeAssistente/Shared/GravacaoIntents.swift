import AppIntents

// Botões da tela bloqueada, da Atividade ao Vivo, do botão de Ação e da Siri.
// O iOS roda estes pedidos dentro do app (abre o app escondido se precisar);
// a extensão só conhece os tipos para montar os botões — por isso o #if.

/// Botão da tela bloqueada e do botão de Ação: grava; se já grava, pausa; se pausado, continua.
struct GravarOuPausarIntent: AudioRecordingIntent, LiveActivityIntent {
    static let title: LocalizedStringResource = "Gravar ou pausar reunião"
    static let description = IntentDescription("Começa a gravar. Se já estiver gravando, pausa. Se estiver pausada, continua.")

    @MainActor
    func perform() async throws -> some IntentResult {
        #if !WIDGET
        do {
            try ControleGravacao.shared.gravarOuPausar()
        } catch let erro as ControleGravacao.Erro {
            throw needsToContinueInForegroundError(IntentDialog(stringLiteral: erro.errorDescription ?? ""), continuation: nil)
        }
        #endif
        return .result()
    }
}

/// Gravar (ou continuar a pausada).
struct GravarReuniaoIntent: AudioRecordingIntent, LiveActivityIntent {
    static let title: LocalizedStringResource = "Gravar reunião"
    static let description = IntentDescription("Começa a gravar a reunião, ou continua a gravação pausada.")

    @MainActor
    func perform() async throws -> some IntentResult {
        #if !WIDGET
        do {
            try ControleGravacao.shared.gravarOuContinuar()
        } catch let erro as ControleGravacao.Erro {
            throw needsToContinueInForegroundError(IntentDialog(stringLiteral: erro.errorDescription ?? ""), continuation: nil)
        }
        #endif
        return .result()
    }
}

struct PausarGravacaoIntent: AudioRecordingIntent, LiveActivityIntent {
    static let title: LocalizedStringResource = "Pausar gravação"
    static let description = IntentDescription("Pausa a gravação. O que já foi gravado fica guardado.")

    @MainActor
    func perform() async throws -> some IntentResult {
        #if !WIDGET
        ControleGravacao.shared.pausar()
        #endif
        return .result()
    }
}

struct PararGravacaoIntent: AudioRecordingIntent, LiveActivityIntent {
    static let title: LocalizedStringResource = "Parar gravação"
    static let description = IntentDescription("Termina a gravação e envia a reunião para o Ações.")

    @MainActor
    func perform() async throws -> some IntentResult {
        #if !WIDGET
        ControleGravacao.shared.parar()
        #endif
        return .result()
    }
}

#if !WIDGET
// Sem conta, sem microfone liberado ou sem Atividade ao Vivo: o iOS pede para abrir o app.
// (Só no app: a extensão não pode abrir o app.)
extension GravarOuPausarIntent: ForegroundContinuableIntent {}
extension GravarReuniaoIntent: ForegroundContinuableIntent {}
#endif
