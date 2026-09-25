import SwiftUI

struct ContentView: View {
    @Environment(AuthStore.self) private var auth

    var body: some View {
        Group {
            switch auth.state {
            case .checking:
                ProgressView()
            case .unauthenticated:
                LoginView()
            case .authenticated, .demonstracao:
                MainTabView()
            }
        }
        .animation(.default, value: auth.state)
    }
}

struct MainTabView: View {
    @State private var aba = 0

    var body: some View {
        TabView(selection: $aba) {
            RecordView(verReunioes: { aba = 1 })
                .tabItem { Label("Gravar", systemImage: "mic.circle.fill") }
                .tag(0)
            HistoryView()
                .tabItem { Label("Reuniões", systemImage: "list.bullet.rectangle") }
                .tag(1)
            SettingsView()
                .tabItem { Label("Ajustes", systemImage: "gearshape") }
                .tag(2)
        }
    }
}
