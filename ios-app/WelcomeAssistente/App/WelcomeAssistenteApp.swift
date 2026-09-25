import SwiftUI

@main
struct WelcomeAssistenteApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @State private var authStore = AuthStore()
    @State private var uploadQueue = UploadQueue()
    @State private var recorder = AudioRecorder()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(authStore)
                .environment(uploadQueue)
                .environment(recorder)
                .task {
                    recorder.aoFecharTrecho = { [uploadQueue] gravacaoId, parte, arquivo in
                        uploadQueue.adicionarTrecho(gravacaoId: gravacaoId, parte: parte, arquivo: arquivo)
                    }
                    await authStore.restoreFromKeychain()
                    uploadQueue.usarToken(authStore.sessionToken, usuarioId: authStore.currentUser?.id)
                }
                .onChange(of: authStore.sessionToken) { _, novo in
                    uploadQueue.usarToken(novo, usuarioId: authStore.currentUser?.id)
                }
                .onChange(of: scenePhase) { _, fase in
                    if fase == .active {
                        Task { await uploadQueue.enviarPendentes() }
                    }
                }
        }
    }
}
