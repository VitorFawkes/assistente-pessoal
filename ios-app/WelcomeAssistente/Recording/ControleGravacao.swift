import ActivityKit
import AppIntents
import AVFoundation
import Foundation
import UIKit

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
    private var observadores: [NSObjectProtocol] = []

    /// Quando a tela bloqueada não consegue gravar sozinha: o iOS pede para abrir o app.
    enum Erro: LocalizedError {
        case precisaEntrar
        case microfone
        case atividadeDesligada
        case avisoNaoAbriu

        var errorDescription: String? {
            switch self {
            case .precisaEntrar: "Abra o Ações e entre com a sua conta do TTARS."
            case .microfone: "Abra o Ações e toque em Gravar uma vez para liberar o microfone."
            case .atividadeDesligada: "As Atividades ao Vivo do Ações estão desligadas (Ajustes → Ações). Abra o Ações para gravar."
            case .avisoNaoAbriu: "O iPhone não deixou gravar com a tela bloqueada agora. Abra o Ações para gravar."
            }
        }

        /// Só falta o aviso da tela bloqueada: com o Ações aberto na frente, grava.
        var gravaComAppAberto: Bool { self == .atividadeDesligada || self == .avisoNaoAbriu }
    }

    private init() {
        gravador.aoFecharTrecho = { [fila] gravacaoId, parte, arquivo in
            fila.adicionarTrecho(gravacaoId: gravacaoId, parte: parte, arquivo: arquivo)
        }
        gravador.aoMudarEstado = { [weak self] in self?.atualizarAtividade() }
        gravador.antesDeContinuar = { [weak self] in try self?.garantirAtividade() }
        Registro.anotar("app abriu")
        let centro = NotificationCenter.default
        let momentos: [(Notification.Name, String)] = [
            (UIApplication.didEnterBackgroundNotification, "app foi para o fundo"),
            (UIApplication.willEnterForegroundNotification, "app voltou para a frente"),
            (UIApplication.didReceiveMemoryWarningNotification, "iPhone com pouca memória"),
            (UIApplication.willTerminateNotification, "app vai fechar"),
        ]
        for (nome, texto) in momentos {
            observadores.append(centro.addObserver(forName: nome, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated {
                    Registro.anotar("\(texto) (gravador: \(self.map { "\($0.gravador.state)" } ?? "-"))")
                }
            })
        }
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
            try garantirAtividade()
            try gravador.iniciar(gravacaoId: id)
        } catch {
            fila.descartar(gravacaoId: id)
            encerrarAtividade()
            throw error
        }
    }

    func pausar() {
        gravador.pausar()
    }

    func continuar() throws {
        do {
            try gravador.continuar()
        } catch {
            atualizarAtividade()
            throw error
        }
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
        Registro.anotar("pedido gravar/pausar (app \(appNaFrente ? "na frente" : "escondido"), gravador: \(gravador.state))")
        switch gravador.state {
        case .idle: try comecarSemTela()
        case .recording: pausar()
        case .pausado, .interrompido: try continuar()
        }
    }

    func gravarOuContinuar() throws {
        Registro.anotar("pedido gravar (app \(appNaFrente ? "na frente" : "escondido"), gravador: \(gravador.state))")
        switch gravador.state {
        case .idle: try comecarSemTela()
        case .recording: break
        case .pausado, .interrompido: try continuar()
        }
    }

    private func comecarSemTela() throws {
        guard auth.currentUser != nil else { throw Erro.precisaEntrar }
        guard AVAudioApplication.shared.recordPermission == .granted else { throw Erro.microfone }
        guard ActivityAuthorizationInfo().areActivitiesEnabled || appNaFrente else { throw Erro.atividadeDesligada }
        try comecar()
    }

    private var appNaFrente: Bool { UIApplication.shared.applicationState == .active }

    // MARK: - Atividade ao Vivo

    private var conteudo: ActivityContent<GravacaoAtividade.ContentState> {
        let segundos = gravador.elapsedSeconds
        return ActivityContent(state: .init(
            pausada: gravador.state != .recording,
            desde: Date().addingTimeInterval(-segundos),
            segundos: segundos
        ), staleDate: nil)
    }

    /// Regra da Apple para gravar escondido (tela bloqueada, botão de Ação, Siri): o aviso da tela
    /// bloqueada abre ANTES do microfone e fica aberto enquanto grava. Microfone ligado sem aviso =
    /// o iPhone corta a gravação em segundos. Com o app aberto na frente, grava mesmo sem o aviso.
    private func garantirAtividade() throws {
        if let id = atividadeId,
           Activity<GravacaoAtividade>.activities.contains(where: { $0.id == id && [.active, .stale].contains($0.activityState) }) {
            return
        }
        atividadeId = nil
        let segundos = gravador.elapsedSeconds
        let gravando = ActivityContent(state: GravacaoAtividade.ContentState(
            pausada: false, desde: Date().addingTimeInterval(-segundos), segundos: segundos
        ), staleDate: nil)
        do {
            let atividade = try Activity.request(attributes: GravacaoAtividade(), content: gravando)
            atividadeId = atividade.id
            Registro.anotar("aviso da tela bloqueada aberto")
            vigiarAtividade(atividade.id)
            encerrarOutrasAtividades(menos: atividade.id)
        } catch {
            Registro.anotar("aviso da tela bloqueada NÃO abriu: \(error.localizedDescription)")
            guard appNaFrente else { throw Erro.avisoNaoAbriu }
        }
    }

    /// Aviso que ficou de uma gravação que morreu com o app: some para não parecer que grava.
    private func encerrarOutrasAtividades(menos id: String) {
        let outras = Activity<GravacaoAtividade>.activities.map(\.id).filter { $0 != id }
        guard !outras.isEmpty else { return }
        mudarAtividade {
            for outra in Activity<GravacaoAtividade>.activities where outras.contains(outra.id) {
                await outra.end(nil, dismissalPolicy: .immediate)
            }
        }
    }

    /// Anota quando o aviso some (a pessoa arrastou, o iPhone encerrou).
    private func vigiarAtividade(_ id: String) {
        Task.detached { [weak self] in
            guard let atividade = Activity<GravacaoAtividade>.activities.first(where: { $0.id == id }) else { return }
            for await estado in atividade.activityStateUpdates {
                await self?.atividadeMudou(id: id, estado: estado)
            }
        }
    }

    private func atividadeMudou(id: String, estado: ActivityState) {
        Registro.anotar("aviso da tela bloqueada: \(estado)\(id == atividadeId ? "" : " (antigo)")")
        if id == atividadeId, estado == .ended || estado == .dismissed {
            atividadeId = nil
        }
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
        Registro.anotar("aviso da tela bloqueada fechado")
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
