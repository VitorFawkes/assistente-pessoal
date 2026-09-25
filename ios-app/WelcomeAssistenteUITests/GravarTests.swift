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
        if let trecho = ambiente["TRECHO_SEGUNDOS"] {
            app.launchArguments += ["-trechoSegundos", trecho]
        }
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

    /// Pausar, continuar e parar pelos botões da tela bloqueada (Atividade ao Vivo), sem abrir o app.
    func testBotoesDaTelaBloqueada() throws {
        continueAfterFailure = false
        let token = try XCTUnwrap(ProcessInfo.processInfo.environment["TOKEN_DE_TESTE"], "passe TEST_RUNNER_TOKEN_DE_TESTE")
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

        app.launchArguments = ["-tokenDeTeste", token]
        app.launch()
        let gravar = app.buttons["Começar a gravar"]
        XCTAssertTrue(gravar.waitForExistence(timeout: 60), "a tela de gravar não apareceu")
        gravar.tap()
        aceitarAvisosDoSistema()
        XCTAssertTrue(app.buttons["Pausar a gravação"].waitForExistence(timeout: 20), "não começou a gravar")
        sleep(4)

        XCUIDevice.shared.perform(NSSelectorFromString("pressLockButton"))
        sleep(2)
        let pausar = springboard.buttons["Pausar"]
        if !pausar.waitForExistence(timeout: 5) {
            springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
        XCTAssertTrue(pausar.waitForExistence(timeout: 20), "a tela bloqueada não mostrou Pausar")
        // Na primeira vez o iOS pergunta se o app pode mostrar Atividades ao Vivo.
        let permitir = springboard.buttons["Permitir"]
        if permitir.waitForExistence(timeout: 3) {
            permitir.tap()
            sleep(2)
        }
        fotoDaTela("bloqueada-1-gravando")
        pausar.tap()

        let continuar = springboard.buttons["Continuar"]
        XCTAssertTrue(continuar.waitForExistence(timeout: 20), "Pausar na tela bloqueada não pausou")
        sleep(2)
        fotoDaTela("bloqueada-2-pausada")
        continuar.tap()
        XCTAssertTrue(pausar.waitForExistence(timeout: 20), "Continuar na tela bloqueada não voltou a gravar")
        sleep(4)
        fotoDaTela("bloqueada-3-gravando-de-novo")

        springboard.buttons["Parar"].tap()
        let fimDaAtividade = Date().addingTimeInterval(20)
        while springboard.buttons["Parar"].exists && Date() < fimDaAtividade { sleep(1) }
        XCTAssertFalse(springboard.buttons["Parar"].exists, "Parar na tela bloqueada não encerrou")
        fotoDaTela("bloqueada-4-parou")

        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(gravar.waitForExistence(timeout: 30), "o app não voltou para o começo depois de Parar")
        let naFila = app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'subindo'")).firstMatch
        let fim = Date().addingTimeInterval(180)
        while naFila.exists && Date() < fim { sleep(2) }
        XCTAssertFalse(naFila.exists, "partes ainda subindo depois de 3 minutos")
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

    /// A tela inteira (tela bloqueada, Ilha Dinâmica), não só o app.
    private func fotoDaTela(_ nome: String) {
        let anexo = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        anexo.name = nome
        anexo.lifetime = .keepAlways
        add(anexo)
    }
}
