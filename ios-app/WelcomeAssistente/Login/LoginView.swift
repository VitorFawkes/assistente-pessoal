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
            ZStack {
                FundoEspaco()
                ScrollView {
                    VStack(spacing: 26) {
                        cabecalho
                        campos
                        botaoEntrar
                        if let erro {
                            Text(erro)
                                .font(.footnote)
                                .foregroundStyle(Estilo.gravando)
                                .multilineTextAlignment(.center)
                        }
                        Button("Esqueci minha senha") { abrirEsqueciSenha() }
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(Estilo.ouro)
                        Spacer(minLength: 12)
                        rodape
                    }
                    .padding(24)
                }
                .scrollDismissesKeyboard(.interactively)
            }
            .navigationBarHidden(true)
            .task { await auth.carregarConfig() }
            .sheet(item: $termos) { endereco in
                SafariView(url: endereco.url).ignoresSafeArea()
            }
        }
    }

    private var cabecalho: some View {
        VStack(spacing: 12) {
            Image("Logo")
                .resizable()
                .frame(width: 104, height: 104)
                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(Estilo.borda))
                .shadow(color: Estilo.ouroForte.opacity(0.35), radius: 26)
            Text("CASE")
                .font(.system(size: 38, weight: .semibold))
                .tracking(12)
                .foregroundStyle(.white)
                .padding(.leading, 12)
            Text("Grave suas reuniões. O resumo e as tarefas aparecem no TTARS, em Ações.")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.6))
                .multilineTextAlignment(.center)
        }
        .padding(.top, 36)
    }

    private var campos: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Use o mesmo e-mail e senha do TTARS.")
                .font(.footnote)
                .foregroundStyle(.white.opacity(0.55))
            caixa(icone: "envelope", ativa: campo == .email) {
                TextField("E-mail", text: $email, prompt: Text("E-mail").foregroundStyle(.white.opacity(0.35)))
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($campo, equals: .email)
                    .submitLabel(.next)
                    .onSubmit { campo = .senha }
            }
            caixa(icone: "lock", ativa: campo == .senha) {
                SecureField("Senha", text: $senha, prompt: Text("Senha").foregroundStyle(.white.opacity(0.35)))
                    .textContentType(.password)
                    .focused($campo, equals: .senha)
                    .submitLabel(.go)
                    .onSubmit { Task { await entrar() } }
            }
        }
    }

    private func caixa<Conteudo: View>(icone: String, ativa: Bool, @ViewBuilder _ conteudo: () -> Conteudo) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icone)
                .foregroundStyle(ativa ? Estilo.ouro : .white.opacity(0.45))
                .frame(width: 22)
            conteudo().foregroundStyle(.white)
        }
        .padding(.horizontal, 16)
        .frame(height: 54)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Estilo.placa))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
            .stroke(ativa ? Estilo.ouro.opacity(0.75) : Estilo.borda, lineWidth: 1))
        .animation(.easeOut(duration: 0.15), value: ativa)
    }

    private var botaoEntrar: some View {
        Button {
            Task { await entrar() }
        } label: {
            HStack {
                if entrando { ProgressView().tint(Estilo.tinta) }
                Text(entrando ? "Entrando…" : "Entrar")
            }
        }
        .buttonStyle(BotaoOuro())
        .disabled(!podeEntrar)
    }

    private var rodape: some View {
        VStack(spacing: 16) {
            Button("Ao entrar, você aceita os termos de uso e a política de privacidade.") {
                if let raw = auth.configRemota?.termos_url, let url = URL(string: raw) {
                    termos = EnderecoAberto(url: url)
                }
            }
            .font(.caption)
            .foregroundStyle(.white.opacity(0.45))
            .multilineTextAlignment(.center)

            Button("Conhecer o app sem entrar") { auth.entrarNaDemonstracao() }
                .font(.footnote.weight(.medium))
                .foregroundStyle(.white.opacity(0.85))
                .padding(.horizontal, 18).padding(.vertical, 9)
                .overlay(Capsule().stroke(Estilo.borda))
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
