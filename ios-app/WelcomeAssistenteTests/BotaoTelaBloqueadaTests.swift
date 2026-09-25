import ActivityKit
import XCTest
@testable import Acoes

/// O botão da tela bloqueada (e do botão de Ação) chama o app sem tela: grava, pausa, continua, para.
/// A conta de teste entra por `TEST_RUNNER_TOKEN_DE_TESTE=<acesso> xcodebuild test …`.
@MainActor
final class BotaoTelaBloqueadaTests: XCTestCase {
    func testUmBotaoGravaPausaEContinua() async throws {
        let token = try XCTUnwrap(ProcessInfo.processInfo.environment["TOKEN_DE_TESTE"], "passe TEST_RUNNER_TOKEN_DE_TESTE")
        let controle = ControleGravacao.shared
        try await controle.auth.entrarParaTeste(token: token)
        controle.fila.usarToken(controle.auth.sessionToken, usuarioId: controle.auth.currentUser?.id)
        XCTAssertEqual(controle.gravador.state, .idle)

        _ = try await GravarOuPausarIntent().perform()
        XCTAssertEqual(controle.gravador.state, .recording, "o botão não começou a gravar")
        try await esperar { !Activity<GravacaoAtividade>.activities.isEmpty }
        let atividade = try XCTUnwrap(Activity<GravacaoAtividade>.activities.first)
        XCTAssertFalse(atividade.content.state.pausada)
        try await Task.sleep(for: .seconds(3))

        _ = try await GravarOuPausarIntent().perform()
        XCTAssertEqual(controle.gravador.state, .pausado, "o segundo toque não pausou")
        try await esperar { Activity<GravacaoAtividade>.activities.first?.content.state.pausada == true }
        XCTAssertGreaterThanOrEqual(controle.gravador.elapsedSeconds, 3)

        _ = try await GravarOuPausarIntent().perform()
        XCTAssertEqual(controle.gravador.state, .recording, "o terceiro toque não continuou")
        try await esperar { Activity<GravacaoAtividade>.activities.first?.content.state.pausada == false }
        try await Task.sleep(for: .seconds(3))

        _ = try await PararGravacaoIntent().perform()
        XCTAssertEqual(controle.gravador.state, .idle)
        try await esperar { Activity<GravacaoAtividade>.activities.allSatisfy { $0.activityState != .active } }
    }

    func testSemContaPedeParaAbrirOApp() throws {
        let controle = ControleGravacao.shared
        controle.auth.sairLocal()
        XCTAssertThrowsError(try controle.gravarOuPausar()) { erro in
            XCTAssertEqual(erro as? ControleGravacao.Erro, .precisaEntrar)
        }
        XCTAssertEqual(controle.gravador.state, .idle)
    }

    private func esperar(_ condicao: @escaping () -> Bool, segundos: Double = 10) async throws {
        let fim = Date().addingTimeInterval(segundos)
        while !condicao() {
            if Date() > fim { XCTFail("não aconteceu em \(Int(segundos)) s"); return }
            try await Task.sleep(for: .milliseconds(200))
        }
    }
}
