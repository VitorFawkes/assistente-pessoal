import SwiftUI

@main
struct WelcomeAssistenteApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    private let controle = ControleGravacao.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(controle.auth)
                .environment(controle.fila)
                .environment(controle.gravador)
                .task {
                    await controle.auth.restoreFromKeychain()
                    controle.fila.usarToken(controle.auth.sessionToken, usuarioId: controle.auth.currentUser?.id)
                }
                .onChange(of: controle.auth.sessionToken) { _, novo in
                    controle.fila.usarToken(novo, usuarioId: controle.auth.currentUser?.id)
                }
                .onChange(of: scenePhase) { _, fase in
                    if fase == .active {
                        Task { await controle.fila.enviarPendentes() }
                    }
                }
        }
    }
}
