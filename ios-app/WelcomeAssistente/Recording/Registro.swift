import Foundation

/// Caixa-preta do gravador: o que aconteceu e em que ordem (sem áudio e sem nome de ninguém).
/// Fica só no iPhone (Documents/gravacoes/registro.txt, últimas 600 linhas) e aparece em Ajustes para copiar.
enum Registro {
    private static let fila = DispatchQueue(label: "br.com.ttars.registro")
    private static let limite = 600

    static var arquivo: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("gravacoes/registro.txt")
    }

    static func anotar(_ texto: String) {
        let quando = Date().formatted(.dateTime.day(.twoDigits).month(.twoDigits)
            .hour(.twoDigits(amPM: .omitted)).minute(.twoDigits).second(.twoDigits))
        let linha = "\(quando) \(texto)\n"
        fila.async {
            let fm = FileManager.default
            try? fm.createDirectory(at: arquivo.deletingLastPathComponent(), withIntermediateDirectories: true)
            var linhas = ((try? String(contentsOf: arquivo, encoding: .utf8)) ?? "")
                .split(separator: "\n", omittingEmptySubsequences: true)
            linhas.append(Substring(linha.dropLast()))
            if linhas.count > limite { linhas.removeFirst(linhas.count - limite) }
            try? (linhas.joined(separator: "\n") + "\n").write(to: arquivo, atomically: true, encoding: .utf8)
        }
    }

    static func ler() -> String {
        fila.sync { (try? String(contentsOf: arquivo, encoding: .utf8)) ?? "" }
    }
}
