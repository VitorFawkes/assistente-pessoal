import SwiftUI

/// Entrar com o mesmo e-mail e senha do TTARS.
struct LoginView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.openURL) private var openURL
    @State private var email = ""
    @State private var senha = ""
    @State private var entrando = false
    @State private var erro: String?
    @State private var termos: EnderecoAberto?
    @FocusState private var campo: Campo?

    private enum Campo { case email, senha }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 28) {
                    cabecalho
                    campos
                    botaoEntrar
                    if let erro {
                        Text(erro)
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .multilineTextAlignment(.center)
                    }
                    Button("Esqueci minha senha") { abrirEsqueciSenha() }
                        .font(.footnote)
                    Spacer(minLength: 16)
                    rodape
                }
                .padding(24)
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationBarHidden(true)
            .task { await auth.carregarConfig() }
            .sheet(item: $termos) { endereco in
                SafariView(url: endereco.url).ignoresSafeArea()
            }
        }
    }

    private var cabecalho: some View {
        VStack(spacing: 8) {
            Image(systemName: "waveform.circle.fill")
                .font(.system(size: 64))
                .foregroundStyle(.tint)
            Text("Ações")
                .font(.largeTitle.weight(.bold))
            Text("Grave suas reuniões. O resumo e as tarefas aparecem no Ações.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(.top, 32)
    }

    private var campos: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Use o mesmo e-mail e senha do TTARS.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            TextField("E-mail", text: $email)
                .textContentType(.username)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
                .focused($campo, equals: .email)
                .submitLabel(.next)
                .onSubmit { campo = .senha }
            SecureField("Senha", text: $senha)
                .textContentType(.password)
                .textFieldStyle(.roundedBorder)
                .focused($campo, equals: .senha)
                .submitLabel(.go)
                .onSubmit { Task { await entrar() } }
        }
    }

    private var botaoEntrar: some View {
        Button {
            Task { await entrar() }
        } label: {
            HStack {
                if entrando { ProgressView().tint(.white) }
                Text(entrando ? "Entrando…" : "Entrar").fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(podeEntrar ? Color.accentColor : Color.secondary.opacity(0.4))
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .disabled(!podeEntrar)
    }

    private var rodape: some View {
        VStack(spacing: 14) {
            Button("Ao entrar, você aceita os termos de uso e a política de privacidade.") {
                if let raw = auth.configRemota?.termos_url, let url = URL(string: raw) {
                    termos = EnderecoAberto(url: url)
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)

            Button("Conhecer o app sem entrar") { auth.entrarNaDemonstracao() }
                .font(.caption)
        }
    }

    private var podeEntrar: Bool {
        !entrando && email.contains("@") && !senha.isEmpty
    }

    private func entrar() async {
        guard podeEntrar else { return }
        erro = nil
        entrando = true
        defer { entrando = false }
        do {
            try await auth.entrar(
                email: email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
                senha: senha
            )
        } catch {
            erro = (error as? LocalizedError)?.errorDescription ?? ErroDeEntrada.outro.errorDescription
        }
    }

    private func abrirEsqueciSenha() {
        Task {
            await auth.carregarConfig()
            if let raw = auth.configRemota?.esqueci_senha_url, let url = URL(string: raw) {
                openURL(url)
            } else {
                erro = "Sem internet. Tente de novo."
            }
        }
    }
}
