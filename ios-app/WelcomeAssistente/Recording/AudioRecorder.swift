import AVFoundation
import Foundation
import Observation
import UserNotifications

/// Grava o microfone em trechos de 5 minutos (arquivos .m4a completos).
///
/// - Continua com a tela bloqueada (UIBackgroundModes = audio + sessão .playAndRecord).
/// - Cada trecho fechado vai para `aoFecharTrecho`, que sobe na hora.
/// - Ligação, Siri ou outro app pegando o microfone: o trecho em andamento é fechado
///   (nada se perde) e, quando a interrupção acaba, o gravador tenta continuar sozinho.
///   Se o iOS não deixar, fica "interrompido" até a pessoa tocar em Continuar.
@Observable
@MainActor
final class AudioRecorder: NSObject {
    enum State: Equatable {
        case idle
        case recording
        case interrompido
    }

    private(set) var state: State = .idle
    private(set) var meterLevel: Double = 0    // 0...1
    private(set) var elapsedSeconds: Double = 0
    private(set) var gravacaoId: String?

    /// (id da gravação, parte = ms do início do trecho, arquivo)
    var aoFecharTrecho: ((String, Int64, URL) -> Void)?

    static let duracaoDoTrecho: TimeInterval = {
        #if DEBUG
        // Só em testes no simulador: trechos curtos (-trechoSegundos 20) para ver a troca acontecer.
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "-trechoSegundos"), i + 1 < args.count, let s = TimeInterval(args[i + 1]) {
            return s
        }
        #endif
        return 5 * 60
    }()

    private var recorder: AVAudioRecorder?
    private var parteAtual: Int64 = 0
    private var ultimaParte: Int64 = 0
    private var inicioDoTrecho: Date?
    private var acumulado: TimeInterval = 0     // segundos de trechos já fechados
    private var proximaTroca: Date?             // troca que falhou: tenta de novo a partir daqui
    private var timer: Timer?
    private var observadores: [NSObjectProtocol] = []

    private let ajustes: [String: Any] = [
        AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
        AVSampleRateKey: 44100.0,
        AVNumberOfChannelsKey: 1,
        AVEncoderBitRateKey: 64000,
        AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
    ]

    override init() {
        super.init()
        let centro = NotificationCenter.default
        observadores.append(centro.addObserver(
            forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
        ) { [weak self] nota in
            let tipo = (nota.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt)
                .flatMap(AVAudioSession.InterruptionType.init(rawValue:))
            MainActor.assumeIsolated { self?.tratarInterrupcao(tipo) }
        })
        observadores.append(centro.addObserver(
            forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.tratarInterrupcao(.began)
                self?.tratarInterrupcao(.ended)
            }
        })
    }

    func requestMicPermission() async -> Bool {
        await withCheckedContinuation { cont in
            AVAudioApplication.requestRecordPermission { granted in
                cont.resume(returning: granted)
            }
        }
    }

    func currentPermission() -> AVAudioApplication.recordPermission {
        AVAudioApplication.shared.recordPermission
    }

    /// Começa (ou continua) a gravação `gravacaoId`, com os trechos na pasta dela.
    func iniciar(gravacaoId: String) throws {
        try ativarSessao()
        if self.gravacaoId != gravacaoId {
            acumulado = 0
        }
        self.gravacaoId = gravacaoId
        proximaTroca = nil
        try iniciarTrecho()
        state = .recording
        iniciarTimer()
    }

    /// Continua depois de uma interrupção (ligação etc.).
    func continuar() throws {
        guard let gravacaoId, state == .interrompido else { return }
        try iniciar(gravacaoId: gravacaoId)
    }

    /// Para de vez. Devolve a duração total gravada.
    @discardableResult
    func parar() -> TimeInterval {
        fecharTrecho()
        pararTimer()
        let total = acumulado
        state = .idle
        gravacaoId = nil
        acumulado = 0
        proximaTroca = nil
        elapsedSeconds = 0
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        return total
    }

    // MARK: - trechos

    private func ativarSessao() throws {
        let session = AVAudioSession.sharedInstance()
        do {
            // .default em vez de .spokenAudio (rejeitado em alguns aparelhos);
            // sem Bluetooth: fone sem fio roubaria o microfone da sala.
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.setActive(true)
        } catch {
            throw NSError(domain: "AudioRecorder", code: -2, userInfo: [
                NSLocalizedDescriptionKey: "Não consegui usar o microfone agora. Feche outros apps que estejam gravando ou numa ligação e tente de novo.",
            ])
        }
    }

    private func iniciarTrecho() throws {
        guard let gravacaoId else { return }
        // Sempre crescente, mesmo se o relógio do iPhone voltar: o servidor junta na ordem da parte.
        let parte = max(Int64(Date().timeIntervalSince1970 * 1000), ultimaParte + 1)
        ultimaParte = parte
        let url = UploadQueue.pasta(da: gravacaoId).appendingPathComponent("\(parte).m4a")
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let rec = try AVAudioRecorder(url: url, settings: ajustes)
        rec.delegate = self
        rec.isMeteringEnabled = true
        guard rec.record() else {
            rec.deleteRecording()
            throw NSError(domain: "AudioRecorder", code: -6, userInfo: [
                NSLocalizedDescriptionKey: "Não consegui começar a gravar. Feche outros apps que usam o microfone e tente de novo.",
            ])
        }
        recorder = rec
        parteAtual = parte
        inicioDoTrecho = Date()
    }

    /// Fecha o arquivo do trecho em andamento e manda subir.
    private func fecharTrecho() {
        guard let rec = recorder, let gravacaoId else { return }
        let url = rec.url
        let duracao = inicioDoTrecho.map { Date().timeIntervalSince($0) } ?? rec.currentTime
        rec.stop()
        recorder = nil
        inicioDoTrecho = nil
        acumulado += duracao
        aoFecharTrecho?(gravacaoId, parteAtual, url)
    }

    /// Troca de arquivo sem soltar o microfone: o trecho novo começa antes de o antigo fechar.
    /// Com a tela bloqueada o iOS não deixa começar a gravar do zero, então o microfone nunca
    /// para na troca. Se o novo não começar, o antigo segue gravando e a troca tenta de novo em 30 s.
    private func girarTrecho() {
        guard let antigo = recorder, let gravacaoId else { return }
        let parteAntiga = parteAtual
        let inicioAntigo = inicioDoTrecho
        do {
            try iniciarTrecho()
        } catch {
            proximaTroca = Date().addingTimeInterval(30)
            return
        }
        proximaTroca = nil
        acumulado += inicioAntigo.map { Date().timeIntervalSince($0) } ?? antigo.currentTime
        antigo.stop()
        aoFecharTrecho?(gravacaoId, parteAntiga, antigo.url)
    }

    /// Pede (uma vez) para poder avisar quando a gravação parar sozinha.
    func pedirPermissaoDeAviso() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    /// Ligação ou outro app tirou o microfone e o iOS não deixou continuar sozinho.
    private func avisarQueParou() {
        let conteudo = UNMutableNotificationContent()
        conteudo.title = "A gravação parou"
        conteudo.body = "O que foi gravado está salvo. Abra o Ações e toque em Continuar."
        conteudo.sound = .default
        let pedido = UNNotificationRequest(identifier: "gravacao-parou", content: conteudo, trigger: nil)
        UNUserNotificationCenter.current().add(pedido)
    }

    private func tratarInterrupcao(_ tipo: AVAudioSession.InterruptionType?) {
        switch tipo {
        case .began:
            guard state == .recording else { return }
            fecharTrecho()
            pararTimer()
            state = .interrompido
        case .ended:
            guard state == .interrompido else { return }
            do {
                try continuar()
            } catch {
                avisarQueParou()
            }
        default:
            break
        }
    }

    // MARK: - timer (nível do microfone, tempo e troca de trecho)

    private func iniciarTimer() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tique() }
        }
    }

    private func tique() {
        guard let rec = recorder, let inicio = inicioDoTrecho else { return }
        rec.updateMeters()
        let avg = rec.averagePower(forChannel: 0)
        let clamped = max(-50, min(0, avg))
        meterLevel = Double((clamped + 50) / 50)
        let noTrecho = Date().timeIntervalSince(inicio)
        elapsedSeconds = acumulado + noTrecho
        if noTrecho >= Self.duracaoDoTrecho, proximaTroca.map({ Date() >= $0 }) ?? true {
            girarTrecho()
        }
    }

    private func pararTimer() {
        timer?.invalidate()
        timer = nil
        meterLevel = 0
    }
}

extension AudioRecorder: AVAudioRecorderDelegate {
    nonisolated func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        Task { @MainActor [weak self] in self?.tratarInterrupcao(.began) }
    }
}
