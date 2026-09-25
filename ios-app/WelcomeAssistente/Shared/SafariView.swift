import SafariServices
import SwiftUI

/// Abre uma página do Ações dentro do app (o login do site vem no próprio endereço).
struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }

    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}

struct EnderecoAberto: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}
