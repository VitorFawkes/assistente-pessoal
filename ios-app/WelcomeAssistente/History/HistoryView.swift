import SwiftUI
import SafariServices

struct HistoryView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(UploadQueue.self) private var queue
    @State private var serverMeetings: [Meeting] = []
    @State private var isLoading = false
    @State private var loadError: String?
    @State private var safariURL: URL?

    var body: some View {
        NavigationStack {
            List {
                if !queue.items.isEmpty {
                    Section("Aguardando envio") {
                        ForEach(queue.items) { rec in
                            PendingRow(rec: rec)
                                .swipeActions {
                                    if rec.status == .failed {
                                        Button("Tentar de novo") {
                                            Task { await queue.retry(rec, authStore: auth) }
                                        }
                                        .tint(.blue)
                                    }
                                    Button("Apagar", role: .destructive) {
                                        queue.delete(rec)
                                    }
                                }
                        }
                    }
                }

                Section(serverMeetings.isEmpty ? "" : "Reuniões") {
                    if isLoading && serverMeetings.isEmpty {
                        HStack { ProgressView(); Text("Carregando…").foregroundStyle(.secondary) }
                    } else if let err = loadError, serverMeetings.isEmpty {
                        Text(err).foregroundStyle(.red)
                    } else if serverMeetings.isEmpty && queue.items.isEmpty {
                        Text("Nenhuma reunião ainda. Comece gravando na aba Gravar.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(serverMeetings) { m in
                            Button {
                                if let url = m.webURL {
                                    safariURL = url
                                }
                            } label: {
                                MeetingRow(meeting: m)
                            }
                            .buttonStyle(.plain)
                            .disabled(m.status != .ready)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Histórico")
            .refreshable { await refresh() }
            .task { await refresh() }
            .sheet(item: Binding(
                get: { safariURL.map(SafariSheetURL.init) },
                set: { safariURL = $0?.url }
            )) { sheet in
                SafariView(url: sheet.url)
                    .ignoresSafeArea()
            }
        }
    }

    private func refresh() async {
        guard let token = auth.sessionToken else { return }
        isLoading = true
        loadError = nil
        do {
            serverMeetings = try await APIClient.shared.listMeetings(token: token, limit: 20)
        } catch {
            loadError = (error as? LocalizedError)?.errorDescription ?? "\(error)"
        }
        isLoading = false
    }
}

private struct PendingRow: View {
    let rec: PendingRecording

    var body: some View {
        HStack {
            statusIcon
            VStack(alignment: .leading, spacing: 2) {
                Text(formattedDate(rec.recordedAt))
                    .font(.subheadline)
                Text(formatDuration(rec.durationSeconds))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let err = rec.lastError, rec.status == .failed {
                    Text(err)
                        .font(.caption2)
                        .foregroundStyle(.red)
                        .lineLimit(2)
                }
            }
            Spacer()
            Text(statusText)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var statusIcon: some View {
        Group {
            switch rec.status {
            case .pending, .uploading:
                ProgressView()
            case .uploaded:
                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
            case .failed:
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            }
        }
        .frame(width: 24)
    }

    private var statusText: String {
        switch rec.status {
        case .pending:   return "Aguardando"
        case .uploading: return "Enviando…"
        case .uploaded:  return "Enviado"
        case .failed:    return "Falhou"
        }
    }

    private func formattedDate(_ d: Date) -> String {
        let f = DateFormatter()
        f.dateStyle = .short
        f.timeStyle = .short
        return f.string(from: d)
    }

    private func formatDuration(_ s: Double) -> String {
        let total = Int(s)
        let m = total / 60
        let sec = total % 60
        return String(format: "%dm %02ds", m, sec)
    }
}

private struct MeetingRow: View {
    let meeting: Meeting

    var body: some View {
        HStack {
            statusBadge
            VStack(alignment: .leading, spacing: 2) {
                Text(displayTitle)
                    .font(.subheadline)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    Text(formattedDate)
                    Text("•")
                    Text(meeting.formattedDuration)
                    if let n = meeting.tarefas_count, n > 0 {
                        Text("•")
                        Text("\(n) tarefa\(n == 1 ? "" : "s")")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer()
            if meeting.status == .ready {
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var displayTitle: String {
        meeting.summary ?? "Reunião"
    }

    private var formattedDate: String {
        guard let d = meeting.recordedAtDate else { return "—" }
        let f = DateFormatter()
        f.dateStyle = .short
        f.timeStyle = .short
        return f.string(from: d)
    }

    private var statusBadge: some View {
        Group {
            switch meeting.status {
            case .processing:
                ProgressView().controlSize(.small)
            case .ready:
                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
            case .failed:
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
            case .archived:
                Image(systemName: "archivebox").foregroundStyle(.secondary)
            }
        }
        .frame(width: 28)
    }
}

private struct SafariSheetURL: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

private struct SafariView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }
    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}
