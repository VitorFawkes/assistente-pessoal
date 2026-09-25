import Foundation
import Observation

/// Fila das gravações que ainda estão subindo. Fica salva em
/// Documents/gravacoes/estado.json; os trechos de áudio ficam em
/// Documents/gravacoes/<id da gravação>/.
///
/// Regras:
/// - cada trecho de 5 min sobe assim que fecha (mesmo gravando, mesmo com a tela bloqueada);
/// - trecho que não subiu (sem internet) fica guardado e tenta de novo depois;
/// - quando a pessoa para e todos os trechos subiram, o app avisa o servidor (fim);
/// - se o servidor já fechou a gravação (409, 30 min sem áudio chegar), o que falta
///   segue para uma gravação nova no servidor, sem perder nada.
@Observable
@MainActor
final class UploadQueue {
    private(set) var gravacoes: [GravacaoLocal] = []
    /// Acesso do aparelho venceu ou foi tirado: nada sobe até entrar de novo.
    private(set) var precisaEntrar = false

    private var token: String?
    private var usuarioId: String?
    /// Envios começados neste processo (a lista do iOS só enxerga depois de um instante).
    private var iniciados: Set<String> = []
    private var rodando = false
    private var rodarDeNovo = false
    private let fm = FileManager.default
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()
    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    /// Maior pedaço aceito pelo servidor é 12 MB; corta com folga.
    private static let tamanhoMaximo = 8 * 1024 * 1024
    private static let tentativasDeFim = 20

    init() {
        gravacoes = carregar()
        BackgroundUploader.shared.activate()
        BackgroundUploader.shared.aoConcluir { [weak self] descricao, status, erro in
            Task { @MainActor in
                self?.concluiu(descricao: descricao, status: status, erro: erro)
            }
        }
    }

    static var pastaRaiz: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return docs.appendingPathComponent("gravacoes", isDirectory: true)
    }

    static func pasta(da gravacaoId: String) -> URL {
        pastaRaiz.appendingPathComponent(gravacaoId, isDirectory: true)
    }

    var temAlgoSubindo: Bool { !gravacoes.isEmpty }

    // MARK: - acesso

    func usarToken(_ novo: String?, usuarioId: String?) {
        token = novo
        self.usuarioId = usuarioId
        if novo != nil {
            precisaEntrar = false
            Task { await enviarPendentes() }
        }
    }

    // MARK: - gravação

    /// Cria a pasta e o registro de uma gravação nova. Devolve o id local.
    func novaGravacao(donoId: String?) throws -> String {
        let id = UUID().uuidString.lowercased()
        try fm.createDirectory(at: Self.pasta(da: id), withIntermediateDirectories: true)
        let g = GravacaoLocal(
            id: id,
            servidorId: UUID().uuidString.lowercased(),
            donoId: donoId,
            iniciadaEm: Date(),
            encerrada: false,
            duracao: 0,
            pedacos: [],
            fimEnviado: false,
            tentativasFim: 0,
            erro: nil
        )
        gravacoes.insert(g, at: 0)
        salvar()
        return id
    }

    /// Um trecho fechou: registra (cortando se passar de 8 MB) e manda subir.
    func adicionarTrecho(gravacaoId: String, parte: Int64, arquivo: URL) {
        guard let i = gravacoes.firstIndex(where: { $0.id == gravacaoId }) else { return }
        let tamanho = (try? fm.attributesOfItem(atPath: arquivo.path)[.size] as? Int) ?? 0
        guard tamanho > 0 else {
            try? fm.removeItem(at: arquivo)
            return
        }
        var novos: [PedacoLocal] = []
        if tamanho <= Self.tamanhoMaximo {
            novos.append(PedacoLocal(parte: parte, chunk: 0, arquivo: arquivo.lastPathComponent, estado: .pendente, tentativas: 0))
        } else if let partes = cortar(arquivo, parte: parte, pasta: Self.pasta(da: gravacaoId)) {
            novos = partes
        } else {
            gravacoes[i].erro = "Não consegui preparar um trecho da gravação."
        }
        gravacoes[i].pedacos.append(contentsOf: novos)
        salvar()
        Task { await enviarPendentes() }
    }

    func encerrar(gravacaoId: String, duracao: Double) {
        guard let i = gravacoes.firstIndex(where: { $0.id == gravacaoId }) else { return }
        gravacoes[i].encerrada = true
        gravacoes[i].duracao = duracao
        salvar()
        Task { await enviarPendentes() }
    }

    /// Ao abrir o app: gravação que ficou "gravando" morreu com o app anterior e não volta.
    /// O que já subiu segue como reunião.
    func encerrarInterrompidas() {
        guard gravacoes.contains(where: { !$0.encerrada }) else { return }
        // Sem dono = demonstração, que nunca envia.
        for g in gravacoes where !g.encerrada && g.donoId == nil {
            try? fm.removeItem(at: Self.pasta(da: g.id))
        }
        gravacoes.removeAll { !$0.encerrada && $0.donoId == nil }
        for i in gravacoes.indices where !gravacoes[i].encerrada {
            gravacoes[i].encerrada = true
        }
        salvar()
    }

    /// Descarta uma gravação local (usado na demonstração, que não envia nada).
    func descartar(gravacaoId: String) {
        try? fm.removeItem(at: Self.pasta(da: gravacaoId))
        gravacoes.removeAll { $0.id == gravacaoId }
        salvar()
    }

    // MARK: - envio

    /// Sobe tudo que está pendente. Pode ser chamado a qualquer hora (é idempotente).
    func enviarPendentes() async {
        guard token != nil, !precisaEntrar else { return }
        if rodando {
            rodarDeNovo = true
            return
        }
        rodando = true
        repeat {
            rodarDeNovo = false
            await rodada()
        } while rodarDeNovo
        rodando = false
    }

    private func rodada() async {
        guard let token, !precisaEntrar else { return }
        let emVoo = await BackgroundUploader.shared.emAndamento()

        // Gravação de outra pessoa que usou este iPhone espera ela entrar de novo.
        for g in gravacoes where g.donoId == usuarioId {
            for p in g.pedacos where p.estado != .enviado {
                let desc = Self.descricaoPedaco(g.id, p, g.servidorId)
                let chave = "p|\(g.id)|\(p.parte)|\(p.chunk)|"
                if iniciados.contains(chave) { continue }
                if emVoo.contains(where: { $0.hasPrefix(chave) }) {
                    if p.estado != .enviando { mudar(g.id, p.id) { $0.estado = .enviando } }
                    continue
                }
                subirPedaco(g, p, descricao: desc, token: token)
            }

            let atual = gravacoes.first(where: { $0.id == g.id }) ?? g
            if atual.encerrada, atual.pedacosFaltando == 0, !atual.fimEnviado,
               atual.tentativasFim < Self.tentativasDeFim,
               !iniciados.contains("f|\(g.id)|"),
               !emVoo.contains(where: { $0.hasPrefix("f|\(g.id)|") }) {
                if atual.pedacos.isEmpty {
                    // Parou antes de qualquer áudio: não há o que enviar.
                    descartar(gravacaoId: g.id)
                } else {
                    subirFim(atual, token: token)
                }
            }
        }
    }

    private func subirPedaco(_ g: GravacaoLocal, _ p: PedacoLocal, descricao: String, token: String) {
        let arquivo = Self.pasta(da: g.id).appendingPathComponent(p.arquivo)
        guard fm.fileExists(atPath: arquivo.path) else {
            // Arquivo sumiu: não dá para reenviar; tira da conta para não travar o fim.
            mudarGravacao(g.id) { $0.pedacos.removeAll { $0.id == p.id } }
            return
        }
        var comps = URLComponents(
            url: Configuration.baseURL.appendingPathComponent("/api/mobile/gravacao/\(g.servidorId)/pedaco"),
            resolvingAgainstBaseURL: false
        )!
        comps.queryItems = [
            URLQueryItem(name: "chunk", value: String(p.chunk)),
            URLQueryItem(name: "parte", value: String(p.parte)),
        ]
        mudar(g.id, p.id) { $0.estado = .enviando; $0.tentativas += 1 }
        let chave = "p|\(g.id)|\(p.parte)|\(p.chunk)|"
        iniciados.insert(chave)
        do {
            try BackgroundUploader.shared.enviarAudio(
                descricao: descricao,
                arquivo: arquivo,
                corpoTemporario: corpo(descricao),
                para: comps.url!,
                token: token,
                nomeDoArquivo: p.arquivo
            )
        } catch {
            iniciados.remove(chave)
            mudar(g.id, p.id) { $0.estado = .pendente }
        }
    }

    private func subirFim(_ g: GravacaoLocal, token: String) {
        let descricao = "f|\(g.id)|\(g.servidorId)"
        mudarGravacao(g.id) { $0.tentativasFim += 1 }
        iniciados.insert("f|\(g.id)|")
        do {
            try BackgroundUploader.shared.enviarJSON(
                descricao: descricao,
                json: ["nome": Self.nomeDaGravacao(g.iniciadaEm)],
                corpoTemporario: corpo(descricao),
                para: Configuration.baseURL.appendingPathComponent("/api/mobile/gravacao/\(g.servidorId)/fim"),
                token: token
            )
        } catch {
            iniciados.remove("f|\(g.id)|")
            mudarGravacao(g.id) { $0.erro = "Não consegui avisar o fim da gravação. Tento de novo." }
        }
    }

    // MARK: - conclusão (chamada pelo BackgroundUploader)

    private func concluiu(descricao: String, status: Int, erro: String?) {
        try? fm.removeItem(at: corpo(descricao))
        let campos = descricao.split(separator: "|").map(String.init)
        if campos.first == "p", campos.count == 5 {
            iniciados.remove("p|\(campos[1])|\(campos[2])|\(campos[3])|")
        } else if campos.first == "f", campos.count == 3 {
            iniciados.remove("f|\(campos[1])|")
        }

        if status == 401 {
            // Acesso tirado ou vencido: guarda tudo e pede para entrar de novo.
            precisaEntrar = true
        }

        if campos.first == "p", campos.count == 5,
           let parte = Int64(campos[2]), let chunk = Int(campos[3]) {
            let gid = campos[1], servidor = campos[4]
            let pid = "\(parte)-\(chunk)"
            switch status {
            case 200..<300:
                if let g = gravacoes.first(where: { $0.id == gid }),
                   let p = g.pedacos.first(where: { $0.id == pid }) {
                    try? fm.removeItem(at: Self.pasta(da: gid).appendingPathComponent(p.arquivo))
                }
                mudar(gid, pid) { $0.estado = .enviado }
                mudarGravacao(gid) { $0.erro = nil }
            case 409:
                // O servidor fechou aquela gravação: o que falta vai para uma nova.
                mudarGravacao(gid) { g in
                    if g.servidorId == servidor { g.servidorId = UUID().uuidString.lowercased() }
                }
                mudar(gid, pid) { $0.estado = .pendente }
            default:
                mudar(gid, pid) { $0.estado = .pendente }
                if status != 401 {
                    mudarGravacao(gid) { $0.erro = "Sem internet agora. O áudio fica guardado e sobe quando ela voltar." }
                }
            }
        } else if campos.first == "f", campos.count == 3 {
            let gid = campos[1]
            if (200..<300).contains(status) {
                try? fm.removeItem(at: Self.pasta(da: gid))
                gravacoes.removeAll { $0.id == gid }
                salvar()
                return
            }
            if status != 401 {
                mudarGravacao(gid) { $0.erro = "Não consegui avisar o fim da gravação. Tento de novo." }
            }
        }
        // Algo ficou pendente: tenta de novo daqui a pouco (se não for falta de acesso).
        if status == 409 || (200..<300).contains(status) {
            Task { await enviarPendentes() }
        } else if status != 401 {
            Task {
                try? await Task.sleep(for: .seconds(30))
                await self.enviarPendentes()
            }
        }
    }

    // MARK: - auxiliares

    private static func descricaoPedaco(_ gid: String, _ p: PedacoLocal, _ servidor: String) -> String {
        "p|\(gid)|\(p.parte)|\(p.chunk)|\(servidor)"
    }

    static func nomeDaGravacao(_ data: Date) -> String {
        let df = DateFormatter()
        df.dateFormat = "dd-MM-yyyy HH'h'mm"
        df.locale = Locale(identifier: "pt_BR")
        return "iPhone \(df.string(from: data)).m4a"
    }

    private func corpo(_ descricao: String) -> URL {
        let nome = descricao.replacingOccurrences(of: "|", with: "_")
        return fm.temporaryDirectory.appendingPathComponent("envio-\(nome).body")
    }

    /// Corta um trecho grande em pedaços de 8 MB (o servidor junta os bytes na ordem).
    private func cortar(_ arquivo: URL, parte: Int64, pasta: URL) -> [PedacoLocal]? {
        guard let entrada = try? FileHandle(forReadingFrom: arquivo) else { return nil }
        defer { try? entrada.close() }
        var pedacos: [PedacoLocal] = []
        var n = 0
        while true {
            let bloco = entrada.readData(ofLength: Self.tamanhoMaximo)
            if bloco.isEmpty { break }
            let nome = "\(parte)-\(n).bin"
            do {
                try bloco.write(to: pasta.appendingPathComponent(nome), options: .atomic)
            } catch {
                return nil
            }
            pedacos.append(PedacoLocal(parte: parte, chunk: n, arquivo: nome, estado: .pendente, tentativas: 0))
            n += 1
        }
        try? fm.removeItem(at: arquivo)
        return pedacos
    }

    private func mudar(_ gid: String, _ pid: String, _ fn: (inout PedacoLocal) -> Void) {
        mudarGravacao(gid) { g in
            if let j = g.pedacos.firstIndex(where: { $0.id == pid }) { fn(&g.pedacos[j]) }
        }
    }

    private func mudarGravacao(_ gid: String, _ fn: (inout GravacaoLocal) -> Void) {
        guard let i = gravacoes.firstIndex(where: { $0.id == gid }) else { return }
        fn(&gravacoes[i])
        salvar()
    }

    private var arquivoEstado: URL { Self.pastaRaiz.appendingPathComponent("estado.json") }

    private func salvar() {
        try? fm.createDirectory(at: Self.pastaRaiz, withIntermediateDirectories: true)
        if let dados = try? encoder.encode(gravacoes) {
            try? dados.write(to: arquivoEstado, options: .atomic)
        }
    }

    private func carregar() -> [GravacaoLocal] {
        guard let dados = try? Data(contentsOf: arquivoEstado),
              var lista = try? decoder.decode([GravacaoLocal].self, from: dados) else { return [] }
        // "enviando" que não está mais em voo volta a pendente em enviarPendentes.
        for i in lista.indices {
            for j in lista[i].pedacos.indices where lista[i].pedacos[j].estado == .enviando {
                lista[i].pedacos[j].estado = .pendente
            }
        }
        return lista
    }
}
