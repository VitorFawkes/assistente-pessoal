import Foundation

/// Uma gravação feita neste iPhone que ainda não terminou de subir.
///
/// O gravador fecha um trecho (arquivo .m4a) a cada 5 minutos. Cada trecho é uma
/// "parte" para o servidor, que junta tudo numa reunião só quando recebe o fim.
/// Se o servidor fechar a gravação por falta de áudio (30 min sem nada chegar),
/// o que ainda não subiu segue para uma gravação nova no servidor (`servidorId`).
struct GravacaoLocal: Codable, Identifiable, Equatable {
    let id: String                 // pasta local: Documents/gravacoes/<id>
    var servidorId: String         // gravação no servidor que recebe os próximos pedaços
    let donoId: String?            // quem gravou: só sobe com o acesso dessa pessoa
    let iniciadaEm: Date
    var encerrada: Bool            // a pessoa tocou em Parar
    var duracao: Double
    var pedacos: [PedacoLocal]
    var fimEnviado: Bool
    var tentativasFim: Int
    var erro: String?

    var pedacosFaltando: Int { pedacos.filter { $0.estado != .enviado }.count }
}

struct PedacoLocal: Codable, Identifiable, Equatable {
    let parte: Int64               // milissegundos do início do trecho (ordem das partes)
    let chunk: Int                 // ordem dentro da parte (trecho maior que 8 MB é cortado)
    let arquivo: String            // nome do arquivo dentro da pasta da gravação
    var estado: Estado
    var tentativas: Int

    var id: String { "\(parte)-\(chunk)" }

    enum Estado: String, Codable {
        case pendente
        case enviando
        case enviado
    }
}
