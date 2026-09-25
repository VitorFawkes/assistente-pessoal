import Foundation

/// Envio via *background* `URLSession`: continua com a tela bloqueada, com o app
/// suspenso e depois de o iOS relançar o app. Cada envio leva uma descrição
/// (`taskDescription`) que a `UploadQueue` usa para saber o que terminou.
///
/// Background sessions só aceitam `uploadTask(with:fromFile:)`: o corpo é montado
/// em arquivo (sem carregar o áudio inteiro na memória).
final class BackgroundUploader: NSObject, @unchecked Sendable {
    static let shared = BackgroundUploader()

    static let sessionIdentifier = "com.welcome.assistente.upload"

    typealias Conclusao = @Sendable (String, Int, String?) -> Void

    /// (descrição, status HTTP — 0 se não chegou resposta, mensagem de erro)
    private var onComplete: Conclusao?
    /// Conclusões que chegaram antes de a fila se registrar (app relançado em segundo plano).
    private var guardadas: [(String, Int, String?)] = []

    /// Guardado pelo AppDelegate em `handleEventsForBackgroundURLSession`.
    var backgroundCompletionHandler: (@Sendable () -> Void)?

    private var responseData: [Int: Data] = [:]
    private let lock = NSLock()

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.sessionIdentifier)
        config.isDiscretionary = false             // não esperar Wi-Fi/carga
        config.sessionSendsLaunchEvents = true      // relançar o app pra entregar conclusão
        config.timeoutIntervalForResource = 6 * 60 * 60
        config.allowsCellularAccess = true
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    private override init() { super.init() }

    /// Força a criação da sessão (re-anexa às tasks em voo após relançamento).
    func activate() { _ = session }

    /// A fila se registra aqui; recebe também o que terminou antes do registro.
    func aoConcluir(_ fn: @escaping Conclusao) {
        lock.lock()
        onComplete = fn
        let atrasadas = guardadas
        guardadas = []
        lock.unlock()
        for (d, s, m) in atrasadas { fn(d, s, m) }
    }

    /// Descrições dos envios ainda em andamento (sobrevivem a relançamento).
    func emAndamento() async -> Set<String> {
        let tasks = await session.allTasks
        return Set(tasks.compactMap { $0.taskDescription })
    }

    /// Sobe um arquivo de áudio como campo "audio" de um formulário.
    func enviarAudio(
        descricao: String,
        arquivo: URL,
        corpoTemporario: URL,
        para url: URL,
        token: String,
        nomeDoArquivo: String
    ) throws {
        let boundary = "Boundary-\(UUID().uuidString)"
        try Self.escreverFormulario(
            boundary: boundary,
            arquivo: arquivo,
            nomeDoArquivo: nomeDoArquivo,
            destino: corpoTemporario
        )
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        iniciar(request, corpo: corpoTemporario, descricao: descricao)
    }

    /// Manda um JSON pequeno (ex.: fechar a gravação) pelo mesmo caminho de fundo.
    func enviarJSON(
        descricao: String,
        json: [String: String],
        corpoTemporario: URL,
        para url: URL,
        token: String
    ) throws {
        try JSONSerialization.data(withJSONObject: json).write(to: corpoTemporario, options: .atomic)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        iniciar(request, corpo: corpoTemporario, descricao: descricao)
    }

    private func iniciar(_ request: URLRequest, corpo: URL, descricao: String) {
        let task = session.uploadTask(with: request, fromFile: corpo)
        task.taskDescription = descricao
        task.resume()
    }

    // MARK: - Formulário em arquivo (não carrega o áudio inteiro na RAM)

    private static func escreverFormulario(
        boundary: String,
        arquivo: URL,
        nomeDoArquivo: String,
        destino: URL
    ) throws {
        let nl = "\r\n"
        if FileManager.default.fileExists(atPath: destino.path) {
            try FileManager.default.removeItem(at: destino)
        }
        FileManager.default.createFile(atPath: destino.path, contents: nil)
        let out = try FileHandle(forWritingTo: destino)
        defer { try? out.close() }

        func write(_ s: String) throws {
            if let d = s.data(using: .utf8) { try out.write(contentsOf: d) }
        }

        try write("--\(boundary)\(nl)")
        try write("Content-Disposition: form-data; name=\"audio\"; filename=\"\(nomeDoArquivo)\"\(nl)")
        try write("Content-Type: application/octet-stream\(nl)\(nl)")

        let input = try FileHandle(forReadingFrom: arquivo)
        defer { try? input.close() }
        while true {
            let chunk = input.readData(ofLength: 1024 * 1024)
            if chunk.isEmpty { break }
            try out.write(contentsOf: chunk)
        }

        try write(nl)
        try write("--\(boundary)--\(nl)")
    }
}

// MARK: - URLSession delegate

extension BackgroundUploader: URLSessionDataDelegate {
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        responseData[dataTask.taskIdentifier, default: Data()].append(data)
        lock.unlock()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let body = responseData.removeValue(forKey: task.taskIdentifier) ?? Data()
        lock.unlock()

        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        let message: String?
        if let error {
            message = error.localizedDescription
        } else if !(200..<300).contains(status) {
            message = "Erro \(status): \(String(data: body, encoding: .utf8)?.prefix(140) ?? "")"
        } else {
            message = nil
        }
        guard let descricao = task.taskDescription else { return }
        let codigo = error == nil ? status : 0
        lock.lock()
        let fn = onComplete
        if fn == nil { guardadas.append((descricao, codigo, message)) }
        lock.unlock()
        fn?(descricao, codigo, message)
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        let handler = backgroundCompletionHandler
        backgroundCompletionHandler = nil
        DispatchQueue.main.async { handler?() }
    }
}
