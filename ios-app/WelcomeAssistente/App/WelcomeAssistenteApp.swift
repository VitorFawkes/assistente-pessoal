import SwiftUI

@main
struct WelcomeAssistenteApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var authStore = AuthStore()
    @State private var uploadQueue = UploadQueue()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(authStore)
                .environment(uploadQueue)
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    if let url = activity.webpageURL {
                        authStore.handleIncomingURL(url)
                    }
                }
                .task {
                    await authStore.restoreFromKeychain()
                    await uploadQueue.processPending(authStore: authStore)
                }
        }
    }
}
