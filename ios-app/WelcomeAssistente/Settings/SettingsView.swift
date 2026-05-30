import SwiftUI
import SafariServices

struct SettingsView: View {
    @Environment(AuthStore.self) private var auth
    @State private var showTerms = false
    @State private var showLogoutAllConfirm = false
    @State private var isLoggingOut = false

    var body: some View {
        NavigationStack {
            Form {
                if let user = auth.currentUser {
                    Section("Conta") {
                        LabeledContent("Nome", value: user.nome)
                        if let email = user.email, !email.isEmpty {
                            LabeledContent("Email", value: email)
                        }
                    }
                }

                Section("Privacidade") {
                    Button("Ler termos & privacidade") {
                        showTerms = true
                    }
                }

                Section {
                    Button("Sair deste dispositivo") {
                        auth.logoutLocal()
                    }
                    .foregroundStyle(.red)

                    Button(role: .destructive) {
                        showLogoutAllConfirm = true
                    } label: {
                        if isLoggingOut {
                            ProgressView()
                        } else {
                            Text("Sair de todos os dispositivos")
                        }
                    }
                    .disabled(isLoggingOut)
                }

                Section("Sobre") {
                    LabeledContent("Versão",
                                   value: "\(Configuration.appVersion) (\(Configuration.buildNumber))")
                    LabeledContent("Servidor",
                                   value: Configuration.baseURL.host ?? "")
                }
            }
            .navigationTitle("Ajustes")
            .sheet(isPresented: $showTerms) {
                SafariView(url: Configuration.baseURL.appendingPathComponent("/termos"))
                    .ignoresSafeArea()
            }
            .alert("Sair de todos os dispositivos?",
                   isPresented: $showLogoutAllConfirm) {
                Button("Cancelar", role: .cancel) {}
                Button("Sair", role: .destructive) {
                    Task {
                        isLoggingOut = true
                        await auth.logoutAllDevices()
                        isLoggingOut = false
                    }
                }
            } message: {
                Text("Você precisará entrar de novo em todos os aparelhos com o seu convite.")
            }
        }
    }
}

private struct SafariView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }
    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}
