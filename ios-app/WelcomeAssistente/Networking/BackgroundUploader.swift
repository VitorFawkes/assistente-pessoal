import Foundation

/// Upload de áudio via *background* `URLSession` — sobrevive à suspensão do app e
/// a relançamentos. Necessário pra gravações grandes (centenas de MB), onde um
/// upload em foreground falharia se a tela bloqueasse ou o app fosse suspenso.
///
/// O servidor (ingest-svc) responde **202 assim que recebe os bytes** e processa
/// em background — então aqui só esperamos a transferência, não a transcrição.
/// Qualquer 2xx = sucesso (o app marca `.uploaded` e apaga o local, sem re-enviar).
///
/// IMPORTANTE: background sessions exigem `uploadTask(with:fromFile:)` (não aceitam
/// body em memória). O multipart é montado em arquivo por streaming, sem carregar
/// o áudio inteiro na RAM.
final class BackgroundUploader: NSObject, @unchecked Sendable {
    static let shared = BackgroundUploader()

    static let sessionIdentifier = "com.welcome.assistente.upload"

    /// Reconciliação de estado — setado pela `UploadQueue`.
    /// (recordingId, success, statusCode, errorMessage)
    var onComplete: (@Sendable (String, Bool, Int, String?) -> Void)?

    /// Guardado pelo AppDelegate em `handleEventsForBackgroundURLSession`.
    var backgroundCompletionHandler: (@Sendable () -> Void)?

    /// Corpo de resposta acumulado por task (pra logar erro do servidor).
    private var responseData: [Int: Data] = [:]
    private let lock = NSLock()

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.sessionIdentifier)
        config.isDiscretionary = false             // não esperar Wi-Fi/carga
        config.sessionSendsLaunchEvents = true      // relançar o app pra entregar conclusão
        config.timeoutIntervalForResource = 6 * 60 * 60  // 6h pra transferir os bytes
        config.allowsCellularAccess = true
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    private override init() { super.init() }

    /// Força a criação da sessão (re-anexa às tasks em voo após relançamento).
    func activate() { _ = session }

    /// Lista os recordingIds que ainda estão em transferência (pra reconciliar no launch).
    func inflightRecordingIds() async -> Set<String> {
        let tasks = await session.allTasks
        return Set(tasks.compactMap { $0.taskDescription })
    }

    /// Monta o multipart em arquivo e dispara o upload em background.
    /// Retorna a URL do arquivo de corpo (a `UploadQueue` apaga após conclusão).
    @discardableResult
    func upload(
        recordingId: String,
        audioURL: URL,
        bodyFileURL: URL,
        to url: URL,
        authToken: String,
        fields: [String: String],
        filename: String
    ) throws -> URL {
        let boundary = "Boundary-\(UUID().uuidString)"
        try Self.writeMultipart(
            boundary: boundary,
            fields: fields,
            fileFieldName: "audio",
            audioURL: audioURL,
            filename: filename,
            mimeType: Self.mimeType(for: audioURL.pathExtension),
            destURL: bodyFileURL
        )

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        request.setValue(
            "multipart/form-data; boundary=\(boundary)",
            forHTTPHeaderField: "Content-Type"
        )
        request.setValue("*/*", forHTTPHeaderField: "Accept")

        let task = session.uploadTask(with: request, fromFile: bodyFileURL)
        task.taskDescription = recordingId
        task.resume()
        return bodyFileURL
    }

    // MARK: - Multipart streaming (não carrega o áudio inteiro na RAM)

    private static func writeMultipart(
        boundary: String,
        fields: [String: String],
        fileFieldName: String,
        audioURL: URL,
        filename: String,
        mimeType: String,
        destURL: URL
    ) throws {
        let nl = "\r\n"
        if FileManager.default.fileExists(atPath: destURL.path) {
            try FileManager.default.removeItem(at: destURL)
        }
        FileManager.default.createFile(atPath: destURL.path, contents: nil)
        let out = try FileHandle(forWritingTo: destURL)
        defer { try? out.close() }

        func write(_ s: String) throws {
            if let d = s.data(using: .utf8) { try out.write(contentsOf: d) }
        }

        for (key, value) in fields {
            try write("--\(boundary)\(nl)")
            try write("Content-Disposition: form-data; name=\"\(key)\"\(nl)\(nl)")
            try write("\(value)\(nl)")
        }
        try write("--\(boundary)\(nl)")
        try write("Content-Disposition: form-data; name=\"\(fileFieldName)\"; filename=\"\(filename)\"\(nl)")
        try write("Content-Type: \(mimeType)\(nl)\(nl)")

        let input = try FileHandle(forReadingFrom: audioURL)
        defer { try? input.close() }
        while true {
            let chunk = input.readData(ofLength: 1024 * 1024)
            if chunk.isEmpty { break }
            try out.write(contentsOf: chunk)
        }

        try write(nl)
        try write("--\(boundary)--\(nl)")
    }

    private static func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "m4a": return "audio/mp4"
        case "mp3": return "audio/mpeg"
        case "wav": return "audio/wav"
        case "aac": return "audio/aac"
        case "mp4": return "video/mp4"
        default:    return "application/octet-stream"
        }
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
        let recordingId = task.taskDescription
        lock.lock()
        let body = responseData.removeValue(forKey: task.taskIdentifier) ?? Data()
        lock.unlock()

        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        let success = error == nil && (200..<300).contains(status)
        let message: String?
        if let error {
            message = error.localizedDescription
        } else if !success {
            message = "Erro \(status): \(String(data: body, encoding: .utf8)?.prefix(140) ?? "")"
        } else {
            message = nil
        }

        if let recordingId {
            onComplete?(recordingId, success, status, message)
        }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        let handler = backgroundCompletionHandler
        backgroundCompletionHandler = nil
        DispatchQueue.main.async { handler?() }
    }
}
