import SwiftUI

struct ContentView: View {
    @Environment(AuthStore.self) private var auth

    var body: some View {
        Group {
            switch auth.state {
            case .checking:
                ProgressView()
            case .unauthenticated:
                OnboardingView()
            case .authenticated:
                MainTabView()
            }
        }
        .animation(.default, value: auth.state)
    }
}

struct MainTabView: View {
    var body: some View {
        TabView {
            RecordView()
                .tabItem {
                    Label("Gravar", systemImage: "mic.circle.fill")
                }
            HistoryView()
                .tabItem {
                    Label("Histórico", systemImage: "list.bullet.rectangle")
                }
            SettingsView()
                .tabItem {
                    Label("Ajustes", systemImage: "gearshape")
                }
        }
    }
}
