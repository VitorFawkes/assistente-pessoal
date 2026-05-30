import SwiftUI
import SafariServices

struct OnboardingView: View {
    @Environment(AuthStore.self) private var auth
    @State private var code: String = ""
    @State private var nome: String = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var showTerms = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 28) {
                    header
                    inputs
                    submitButton
                    if let err = errorMessage {
                        Text(err)
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .multilineTextAlignment(.center)
                    }
                    Spacer(minLength: 24)
                    termsButton
                }
                .padding(24)
            }
            .navigationBarHidden(true)
            .sheet(isPresented: $showTerms) {
                if let url = URL(string: Configuration.baseURL.appendingPathComponent("/termos").absoluteString) {
                    SafariView(url: url).ignoresSafeArea()
                }
            }
            .onAppear {
                if let pending = auth.pendingInviteCode {
                    code = pending
                }
            }
            .onChange(of: auth.pendingInviteCode) { _, new in
                if let new { code = new }
            }
        }
    }

    private var header: some View {
        VStack(spacing: 8) {
            Image(systemName: "waveform.circle.fill")
                .font(.system(size: 64))
                .foregroundStyle(.tint)
            Text("Welcome")
                .font(.largeTitle.weight(.bold))
            Text("Gravador de reuniões com extração automática de tarefas.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(.top, 32)
    }

    private var inputs: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Código de convite")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                TextField("ABC123", text: $code)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("Seu nome")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                TextField("Como te chamam", text: $nome)
                    .textInputAutocapitalization(.words)
                    .textFieldStyle(.roundedBorder)
            }
        }
    }

    private var submitButton: some View {
        Button {
            Task { await submit() }
        } label: {
            HStack {
                if isSubmitting { ProgressView().tint(.white) }
                Text(isSubmitting ? "Entrando…" : "Entrar")
                    .fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(canSubmit ? Color.accentColor : Color.secondary.opacity(0.4))
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .disabled(!canSubmit)
    }

    private var canSubmit: Bool {
        !isSubmitting
            && code.trimmingCharacters(in: .whitespacesAndNewlines).count >= 3
            && nome.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2
    }

    private var termsButton: some View {
        Button("Ler termos & privacidade") {
            showTerms = true
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
    }

    private func submit() async {
        errorMessage = nil
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            try await auth.loginWithInvite(
                code: code.trimmingCharacters(in: .whitespacesAndNewlines),
                nome: nome.trimmingCharacters(in: .whitespacesAndNewlines)
            )
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription
                ?? "Não foi possível entrar. Verifique o código."
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
