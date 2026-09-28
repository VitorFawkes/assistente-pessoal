import SwiftUI

struct HistoryView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(UploadQueue.self) private var queue
    @State private var reunioes: [Meeting] = []
    @State private var carregando = false
    @State private var erro: String?
    @State private var aberto: EnderecoAberto?

    var body: some View {
        NavigationStack {
            List {
                if !queue.gravacoes.isEmpty && !auth.emDemonstracao {
                    Section("Subindo") {
                        ForEach(queue.gravacoes) { g in
                            GravacaoLinha(gravacao: g, precisaEntrar: queue.precisaEntrar)
                        }
                    }
                    .listRowBackground(Estilo.placa)
                }

                Section(reunioes.isEmpty ? "" : "Suas reuniões") {
                    if auth.emDemonstracao {
                        Text("Na demonstração nada é enviado. Entre com a conta do TTARS para ver suas reuniões.")
                            .foregroundStyle(.white.opacity(0.6))
                    } else if carregando && reunioes.isEmpty {
                        HStack { ProgressView().tint(Estilo.ouro); Text("Carregando…").foregroundStyle(.white.opacity(0.6)) }
                    } else if let erro, reunioes.isEmpty {
                        Text(erro).foregroundStyle(Estilo.gravando)
                    } else if reunioes.isEmpty {
                        VStack(spacing: 14) {
                            RoboCASE().frame(width: 46, height: 80)
                            Text("Nenhuma reunião ainda. Grave a primeira na aba Gravar.")
                                .foregroundStyle(.white.opacity(0.6))
                                .multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 18)
                    } else {
                        ForEach(reunioes) { m in
                            Button { abrir("/reunioes/\(m.id)") } label: { MeetingRow(meeting: m) }
                                .buttonStyle(.plain)
                                .disabled(m.status != .ready)
                        }
                    }
                }
                .listRowBackground(Estilo.placa)
            }
            .listStyle(.insetGrouped)
            .listaNoEspaco()
            .navigationTitle("Reuniões")
            .toolbar {
                if !auth.emDemonstracao {
                    Button("Abrir o Ações") { abrir("/") }
                }
            }
            .refreshable { await atualizar() }
            .task { await atualizar() }
            .sheet(item: $aberto) { endereco in
                SafariView(url: endereco.url).ignoresSafeArea()
            }
        }
    }

    private func atualizar() async {
        guard let token = auth.sessionToken else { return }
        carregando = true
        erro = nil
        do {
            reunioes = try await APIClient.shared.listMeetings(token: token)
        } catch APIError.http(let status, _) where status == 401 {
            auth.sairLocal()
        } catch {
            erro = "Não consegui carregar agora. Puxe para baixo para tentar de novo."
        }
        carregando = false
    }

    /// O site abre já logado, por um endereço que vale uma vez só.
    private func abrir(_ caminho: String) {
        guard let token = auth.sessionToken else { return }
        Task {
            do {
                aberto = EnderecoAberto(url: try await APIClient.shared.enderecoDoSite(token: token, para: caminho))
            } catch {
                erro = "Sem internet. Tente de novo."
            }
        }
    }
}

private struct GravacaoLinha: View {
    let gravacao: GravacaoLocal
    let precisaEntrar: Bool

    var body: some View {
        HStack {
            if gravacao.erro != nil || precisaEntrar {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Estilo.ouro).frame(width: 24)
            } else {
                ProgressView().tint(Estilo.ouro).frame(width: 24)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(gravacao.iniciadaEm.formatted(.dateTime.day().month(.abbreviated).hour().minute()))
                    .font(.subheadline)
                    .foregroundStyle(.white)
                Text(situacao).font(.caption).foregroundStyle(.white.opacity(0.55))
            }
        }
    }

    private var situacao: String {
        if precisaEntrar { return "Entre de novo para enviar." }
        if let erro = gravacao.erro { return erro }
        if !gravacao.encerrada { return "Gravando…" }
        let faltam = gravacao.pedacosFaltando
        if faltam > 0 { return faltam == 1 ? "Falta subir 1 parte." : "Faltam subir \(faltam) partes." }
        return "Terminando o envio…"
    }
}

private struct MeetingRow: View {
    let meeting: Meeting

    var body: some View {
        HStack(spacing: 12) {
            statusBadge
            VStack(alignment: .leading, spacing: 5) {
                Text(meeting.summary ?? (meeting.status == .processing ? "Preparando o resumo…" : "Reunião"))
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                HStack(spacing: 6) {
                    Text(dataFormatada)
                    Text("•")
                    Text(meeting.formattedDuration)
                    if let n = meeting.tarefas_count, n > 0 {
                        Text("\(n) tarefa\(n == 1 ? "" : "s")")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Estilo.ouro)
                            .padding(.horizontal, 7).padding(.vertical, 2)
                            .background(Capsule().fill(Estilo.ouro.opacity(0.14)))
                    }
                }
                .font(.caption)
                .foregroundStyle(.white.opacity(0.5))
            }
            Spacer()
            if meeting.status == .ready {
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.white.opacity(0.35))
            }
        }
        .padding(.vertical, 4)
    }

    private var dataFormatada: String {
        meeting.recordedAtDate?.formatted(.dateTime.day().month(.abbreviated).hour().minute()) ?? "—"
    }

    private var statusBadge: some View {
        Group {
            switch meeting.status {
            case .processing: ProgressView().controlSize(.small).tint(Estilo.ouro)
            case .ready: Image(systemName: "checkmark.circle.fill").foregroundStyle(Estilo.ouro)
            case .failed: Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Estilo.gravando)
            case .archived: Image(systemName: "archivebox").foregroundStyle(.white.opacity(0.4))
            }
        }
        .frame(width: 28)
    }
}
