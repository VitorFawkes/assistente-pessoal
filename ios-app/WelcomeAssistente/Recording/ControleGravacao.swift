import ActivityKit
import AppIntents
import AVFoundation
import Foundation

/// Dono único da gravação: a tela do app, a tela bloqueada, o botão de Ação e a Siri passam por aqui.
/// Nasce quando o app abre — inclusive quando o iOS abre o app escondido para atender um botão.
@MainActor
final class ControleGravacao {
    static let shared = ControleGravacao()

    let auth = AuthStore()
    let fila = UploadQueue()
    let gravador = AudioRecorder()
    /// Só o id: a Atividade em si é mexida fora da linha principal, uma mudança por vez.
    private var atividadeId: String?
    private var ultimaMudanca: Task<Void, Never>?

    /// Quando a tela bloqueada não consegue gravar sozinha: o iOS pede para abrir o app.
    enum Erro: LocalizedError {
        case precisaEntrar
        case microfone
        case atividadeDesligada

        var errorDescription: String? {
            switch self {
            case .precisaEntrar: "Abra o Ações e entre com a sua conta do TTARS."
            case .microfone: "Abra o Ações e toque em Gravar uma vez para liberar o microfone."
            case .atividadeDesligada: "Ligue as Atividades ao Vivo do Ações em Ajustes para gravar pela tela bloqueada."
            }
        }
    }

    private init() {
        gravador.aoFecharTrecho = { [fila] gravacaoId, parte, arquivo in
            fila.adicionarTrecho(gravacaoId: gravacaoId, parte: parte, arquivo: arquivo)
        }
        gravador.aoMudarEstado = { [weak self] in self?.atualizarAtividade() }
        // Gravação que o iOS encerrou junto com o app não volta: o que subiu vira reunião.
        fila.encerrarInterrompidas()
        fila.usarToken(auth.sessionToken, usuarioId: auth.currentUser?.id)
        let sobras = Activity<GravacaoAtividade>.activities.map(\.id)
        if !sobras.isEmpty {
            mudarAtividade {
                for sobra in Activity<GravacaoAtividade>.activities where sobras.contains(sobra.id) {
                    await sobra.end(nil, dismissalPolicy: .immediate)
                }
            }
        }
    }

    // MARK: - pela tela do app (a tela já pediu o microfone)

    func comecar() throws {
        guard gravador.state == .idle else { return }
        let id = try fila.novaGravacao(donoId: auth.currentUser?.id)
        do {
            try gravador.iniciar(gravacaoId: id)
        } catch {
            fila.descartar(gravacaoId: id)
            throw error
        }
        iniciarAtividade()
    }

    func pausar() {
        gravador.pausar()
    }

    func continuar() throws {
        try gravador.continuar()
    }

    /// Termina de vez: manda o fim (ou descarta, na demonstração).
    func parar() {
        guard let id = gravador.gravacaoId else { return }
        let duracao = gravador.parar()
        if auth.emDemonstracao {
            fila.descartar(gravacaoId: id)
        } else {
            fila.encerrar(gravacaoId: id, duracao: duracao)
        }
        encerrarAtividade()
    }

    // MARK: - pela tela bloqueada, botão de Ação e Siri

    func gravarOuPausar() throws {
        switch gravador.state {
        case .idle: try comecarSemTela()
        case .recording: pausar()
        case .pausado, .interrompido: try continuar()
        }
    }

    func gravarOuContinuar() throws {
        switch gravador.state {
        case .idle: try comecarSemTela()
        case .recording: break
        case .pausado, .interrompido: try continuar()
        }
    }

    private func comecarSemTela() throws {
        guard auth.currentUser != nil else { throw Erro.precisaEntrar }
        guard AVAudioApplication.shared.recordPermission == .granted else { throw Erro.microfone }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { throw Erro.atividadeDesligada }
        try comecar()
    }

    // MARK: - Atividade ao Vivo

    private var conteudo: ActivityContent<GravacaoAtividade.ContentState> {
        let segundos = gravador.elapsedSeconds
        return ActivityContent(state: .init(
            pausada: gravador.state != .recording,
            desde: Date().addingTimeInterval(-segundos),
            segundos: segundos
        ), staleDate: nil)
    }

    private func iniciarAtividade() {
        encerrarAtividade()
        atividadeId = (try? Activity.request(attributes: GravacaoAtividade(), content: conteudo))?.id
    }

    private func atualizarAtividade() {
        guard let id = atividadeId, gravador.state != .idle else { return }
        let novo = conteudo
        mudarAtividade {
            await Activity<GravacaoAtividade>.activities.first { $0.id == id }?.update(novo)
        }
    }

    private func encerrarAtividade() {
        guard let id = atividadeId else { return }
        atividadeId = nil
        mudarAtividade {
            await Activity<GravacaoAtividade>.activities.first { $0.id == id }?.end(nil, dismissalPolicy: .immediate)
        }
    }

    /// Mudanças na Atividade saem na ordem em que aconteceram.
    private func mudarAtividade(_ trabalho: @escaping @Sendable () async -> Void) {
        let anterior = ultimaMudanca
        ultimaMudanca = Task.detached {
            await anterior?.value
            await trabalho()
        }
    }
}

/// Frases da Siri (e atalhos para o botão de Ação).
struct AcoesAtalhos: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: GravarReuniaoIntent(),
            phrases: ["Gravar reunião no \(.applicationName)", "Gravar no \(.applicationName)"],
            shortTitle: "Gravar reunião",
            systemImageName: "mic.fill"
        )
        AppShortcut(
            intent: PausarGravacaoIntent(),
            phrases: ["Pausar gravação no \(.applicationName)", "Pausar o \(.applicationName)"],
            shortTitle: "Pausar gravação",
            systemImageName: "pause.fill"
        )
        AppShortcut(
            intent: PararGravacaoIntent(),
            phrases: ["Parar gravação no \(.applicationName)", "Parar o \(.applicationName)"],
            shortTitle: "Parar gravação",
            systemImageName: "stop.fill"
        )
    }
}
