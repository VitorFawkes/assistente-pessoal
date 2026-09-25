import SwiftUI

struct SettingsView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(UploadQueue.self) private var queue
    @State private var aberto: EnderecoAberto?
    @State private var confirmarSaida = false
    @State private var saindo = false
    @State private var erro: String?

    var body: some View {
        NavigationStack {
            Form {
                if let user = auth.currentUser {
                    Section("Conta") {
                        LabeledContent("Nome", value: user.nome)
                        if let email = user.email, !email.isEmpty {
                            LabeledContent("E-mail", value: email)
                        }
                    }
                    Section {
                        Button("Abrir o Ações") { abrir("/") }
                        Button("Quem vê minhas reuniões") { abrir("/seguranca/sessoes") }
                    } footer: {
                        if let erro { Text(erro).foregroundStyle(.red) }
                    }
                }

                Section("Privacidade") {
                    Button("Termos de uso e privacidade") {
                        Task {
                            await auth.carregarConfig()
                            if let raw = auth.configRemota?.termos_url, let url = URL(string: raw) {
                                aberto = EnderecoAberto(url: url)
                            }
                        }
                    }
                }

                Section {
                    if auth.emDemonstracao {
                        Button("Sair da demonstração") { auth.sairLocal() }
                    } else {
                        Button(role: .destructive) {
                            confirmarSaida = true
                        } label: {
                            if saindo { ProgressView() } else { Text("Sair deste iPhone") }
                        }
                        .disabled(saindo)
                    }
                }

                Section("Sobre") {
                    LabeledContent("Versão", value: "\(Configuration.appVersion) (\(Configuration.buildNumber))")
                }
            }
            .navigationTitle("Ajustes")
            .sheet(item: $aberto) { endereco in
                SafariView(url: endereco.url).ignoresSafeArea()
            }
            .alert("Sair deste iPhone?", isPresented: $confirmarSaida) {
                Button("Cancelar", role: .cancel) {}
                Button("Sair", role: .destructive) {
                    Task {
                        saindo = true
                        await auth.sair()
                        saindo = false
                    }
                }
            } message: {
                Text(queue.temAlgoSubindo
                     ? "Ainda há gravação subindo. Ela fica guardada neste iPhone e só sobe quando você entrar de novo."
                     : "Para gravar de novo, entre com o e-mail e a senha do TTARS.")
            }
        }
    }

    private func abrir(_ caminho: String) {
        guard let token = auth.sessionToken else { return }
        erro = nil
        Task {
            do {
                aberto = EnderecoAberto(url: try await APIClient.shared.enderecoDoSite(token: token, para: caminho))
            } catch {
                erro = "Sem internet. Tente de novo."
            }
        }
    }
}
