import XCTest

/// Testes de tela no simulador. A conta de teste entra por
/// `TEST_RUNNER_TOKEN_DE_TESTE=<acesso> xcodebuild test …` (só existe em DEBUG).
@MainActor
final class GravarTests: XCTestCase {
    private lazy var app = XCUIApplication()

    /// Grava, vai para o fundo (o mesmo que bloquear a tela), volta, para e espera tudo subir.
    func testGravaNoFundoESobeTudo() throws {
        continueAfterFailure = false
        let ambiente = ProcessInfo.processInfo.environment
        let token = try XCTUnwrap(ambiente["TOKEN_DE_TESTE"], "passe TEST_RUNNER_TOKEN_DE_TESTE")
        let noFundo = UInt32(ambiente["SEGUNDOS_NO_FUNDO"] ?? "30") ?? 30

        app.launchArguments = ["-tokenDeTeste", token]
        app.launch()

        let gravar = app.buttons["Começar a gravar"]
        XCTAssertTrue(gravar.waitForExistence(timeout: 60), "a tela de gravar não apareceu")
        foto("1-pronto-para-gravar")
        gravar.tap()
        aceitarAvisosDoSistema()

        let parar = app.buttons["Parar a gravação"]
        XCTAssertTrue(parar.waitForExistence(timeout: 20), "não começou a gravar")
        sleep(3)
        foto("2-gravando")

        XCUIDevice.shared.press(.home)
        sleep(noFundo)
        app.activate()

        XCTAssertTrue(parar.waitForExistence(timeout: 20), "parou de gravar no fundo")
        let tempo = segundosNaTela()
        XCTAssertGreaterThanOrEqual(tempo, Int(noFundo), "o tempo não andou no fundo")
        foto("3-voltou-do-fundo")

        parar.tap()
        XCTAssertTrue(app.staticTexts["Pronto! A reunião aparece no Ações em alguns minutos."].waitForExistence(timeout: 15))
        foto("4-parou")

        let subindo = app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'subindo'")).firstMatch
        let fim = Date().addingTimeInterval(180)
        while subindo.exists && Date() < fim { sleep(2) }
        XCTAssertFalse(subindo.exists, "partes ainda subindo depois de 3 minutos")

        app.tabBars.buttons["Reuniões"].tap()
        let naFila = app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'Terminando o envio' OR label CONTAINS 'Falta subir' OR label CONTAINS 'Faltam subir'")).firstMatch
        let fimDaFila = Date().addingTimeInterval(120)
        while naFila.exists && Date() < fimDaFila { sleep(2) }
        XCTAssertFalse(naFila.exists, "a gravação não terminou de subir")
        foto("5-reunioes")
    }

    /// O caminho de quem não tem conta (revisão da Apple): grava no aparelho e não envia nada.
    func testDemonstracaoGravaSemEnviar() {
        continueAfterFailure = false
        app.launch()
        let conhecer = app.buttons["Conhecer o app sem entrar"]
        XCTAssertTrue(conhecer.waitForExistence(timeout: 60), "a tela de entrar não apareceu")
        foto("demo-1-entrar")
        conhecer.tap()

        let gravar = app.buttons["Começar a gravar"]
        XCTAssertTrue(gravar.waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["Demonstração: nada é enviado."].exists)
        gravar.tap()
        aceitarAvisosDoSistema()

        let parar = app.buttons["Parar a gravação"]
        XCTAssertTrue(parar.waitForExistence(timeout: 20), "não começou a gravar na demonstração")
        sleep(4)
        foto("demo-2-gravando")
        parar.tap()
        XCTAssertTrue(app.staticTexts["Demonstração: a gravação ficou só neste iPhone e foi apagada."].waitForExistence(timeout: 10))
        foto("demo-3-parou")

        app.tabBars.buttons["Ajustes"].tap()
        let sair = app.buttons["Sair da demonstração"]
        XCTAssertTrue(sair.waitForExistence(timeout: 10))
        sair.tap()
        XCTAssertTrue(conhecer.waitForExistence(timeout: 10), "não voltou para a tela de entrar")
    }

    // MARK: - auxiliares

    /// Microfone e avisos: o iOS pergunta uma vez; o teste responde que sim.
    private func aceitarAvisosDoSistema() {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for _ in 0..<2 {
            let botao = ["Permitir", "Allow", "OK"].lazy
                .map { springboard.buttons[$0] }
                .first { $0.waitForExistence(timeout: 3) }
            guard let botao else { return }
            botao.tap()
        }
    }

    private func segundosNaTela() -> Int {
        let rotulo = app.staticTexts.matching(NSPredicate(format: "label MATCHES '^[0-9:]+$'")).firstMatch.label
        return rotulo.split(separator: ":").reduce(0) { $0 * 60 + (Int($1) ?? 0) }
    }

    private func foto(_ nome: String) {
        let anexo = XCTAttachment(screenshot: app.screenshot())
        anexo.name = nome
        anexo.lifetime = .keepAlways
        add(anexo)
    }
}
