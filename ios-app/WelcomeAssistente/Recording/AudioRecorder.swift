import AVFoundation
import Foundation
import Observation
import UserNotifications

/// Grava o microfone em trechos de 5 minutos (arquivos .m4a completos).
///
/// - Continua com a tela bloqueada (UIBackgroundModes = audio + sessão .playAndRecord que se mistura
///   com outros sons: sessão exclusiva é recusada pelo iPhone quando o app está escondido).
/// - Cada trecho fechado vai para `aoFecharTrecho`, que sobe na hora.
/// - Ligação, Siri ou outro app pegando o microfone: o trecho em andamento é fechado
///   (nada se perde) e, quando a interrupção acaba, o gravador tenta continuar sozinho.
///   Se o iOS não deixar, fica "interrompido" até a pessoa tocar em Continuar.
/// - Pausar fecha o trecho e solta o microfone; continuar abre um trecho novo.
@Observable
@MainActor
final class AudioRecorder: NSObject {
    enum State: Equatable {
        case idle
        case recording
        case pausado
        case interrompido
    }

    private(set) var state: State = .idle
    private(set) var meterLevel: Double = 0    // 0...1
    private(set) var elapsedSeconds: Double = 0
    private(set) var gravacaoId: String?

    /// (id da gravação, parte = ms do início do trecho, arquivo)
    var aoFecharTrecho: ((String, Int64, URL) -> Void)?
    /// Qualquer mudança de estado, venha da tela, da tela bloqueada ou de uma ligação.
    var aoMudarEstado: (() -> Void)?
    /// Antes de voltar a gravar (pausa, fim de ligação, parada do iPhone): abre o aviso da tela bloqueada.
    var antesDeContinuar: (() throws -> Void)?

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
    private var proximoSinal: Date?             // próxima linha "ainda gravando" no registro
    private var ultimaRetomada: Date?           // gravador desligado pelo iPhone: última tentativa de continuar
    private var emInterrupcao = false           // ligação etc. em andamento: o fim dela é que retoma
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
            let motivo = nota.userInfo?[AVAudioSessionInterruptionReasonKey] as? UInt
            MainActor.assumeIsolated {
                Registro.anotar("microfone interrompido: \(tipo == .began ? "começou" : "acabou") (motivo \(motivo.map(String.init) ?? "-"))")
                self?.emInterrupcao = tipo == .began
                self?.tratarInterrupcao(tipo)
            }
        })
        observadores.append(centro.addObserver(
            forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
        ) { nota in
            let motivo = nota.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
            let entrada = AVAudioSession.sharedInstance().currentRoute.inputs.first?.portType.rawValue ?? "nenhuma"
            Registro.anotar("microfone trocado (motivo \(motivo.map(String.init) ?? "-"), entrada \(entrada))")
        })
        observadores.append(centro.addObserver(
            forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                Registro.anotar("serviço de áudio do iPhone reiniciou")
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
        iniciarTimer()
        proximoSinal = Date().addingTimeInterval(60)
        Registro.anotar("gravando (já gravado: \(Int(acumulado)) s)")
        mudarEstado(.recording)
    }

    /// Continua depois de uma pausa ou de uma interrupção (ligação etc.).
    func continuar() throws {
        guard let gravacaoId, state == .pausado || state == .interrompido else { return }
        try antesDeContinuar?()
        try iniciar(gravacaoId: gravacaoId)
    }

    /// Pausa: o trecho fecha (e sobe) e o microfone fica livre até continuar.
    func pausar() {
        guard state == .recording else { return }
        fecharTrecho()
        pararTimer()
        elapsedSeconds = acumulado
        Registro.anotar("pausado (\(Int(acumulado)) s)")
        mudarEstado(.pausado)
    }

    /// Para de vez. Devolve a duração total gravada.
    @discardableResult
    func parar() -> TimeInterval {
        fecharTrecho()
        pararTimer()
        let total = acumulado
        gravacaoId = nil
        acumulado = 0
        proximaTroca = nil
        elapsedSeconds = 0
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        Registro.anotar("parado (\(Int(total)) s no total)")
        mudarEstado(.idle)
        return total
    }

    private func mudarEstado(_ novo: State) {
        guard state != novo else { return }
        state = novo
        aoMudarEstado?()
    }

    // MARK: - trechos

    private func ativarSessao() throws {
        let session = AVAudioSession.sharedInstance()
        do {
            // .default em vez de .spokenAudio (rejeitado em alguns aparelhos);
            // sem Bluetooth: fone sem fio roubaria o microfone da sala;
            // .mixWithOthers: com o app escondido (tela bloqueada) o iPhone recusa sessão exclusiva.
            try session.setCategory(.playAndRecord, mode: .default, options: [.mixWithOthers, .defaultToSpeaker])
            try session.setActive(true)
        } catch {
            Registro.anotar("microfone recusado: \((error as NSError).code) \(error.localizedDescription)")
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
            Registro.anotar("gravador não começou")
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
        Registro.anotar("trecho fechado: \(Int(duracao)) s no relógio, \(Int(rec.currentTime)) s no gravador")
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
            Registro.anotar("troca de trecho falhou; o trecho atual segue gravando")
            proximaTroca = Date().addingTimeInterval(30)
            return
        }
        Registro.anotar("trecho trocado: \(Int(antigo.currentTime)) s no gravador")
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
            elapsedSeconds = acumulado
            mudarEstado(.interrompido)
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
        if let sinal = proximoSinal, Date() >= sinal {
            proximoSinal = sinal.addingTimeInterval(60)
            Registro.anotar("ainda gravando: \(Int(elapsedSeconds)) s, gravador \(rec.isRecording ? "ligado" : "DESLIGADO"), nível \(Int(avg)) dB")
        }
        if noTrecho >= Self.duracaoDoTrecho, proximaTroca.map({ Date() >= $0 }) ?? true {
            girarTrecho()
        }
    }

    private func pararTimer() {
        timer?.invalidate()
        timer = nil
        meterLevel = 0
    }

    /// O iPhone desligou o gravador sem a gente pedir: trata como interrupção (fecha o trecho, nada se perde).
    private func gravadorParouSozinho(_ id: ObjectIdentifier, ok: Bool) {
        guard let rec = recorder, ObjectIdentifier(rec) == id else { return }
        Registro.anotar("o iPhone desligou o gravador (ok: \(ok))")
        tratarInterrupcao(.began)
        // Se foi uma ligação, o aviso dela chega logo depois e o fim dela retoma sozinho.
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            self?.retomarDepoisDeParar()
        }
    }

    /// Tenta continuar uma vez (não fica em círculo); se o iPhone não deixar, avisa.
    private func retomarDepoisDeParar() {
        guard state == .interrompido, !emInterrupcao else { return }
        if ultimaRetomada.map({ Date().timeIntervalSince($0) > 30 }) ?? true {
            ultimaRetomada = Date()
            if (try? continuar()) != nil { return }
        }
        avisarQueParou()
    }
}

extension AudioRecorder: AVAudioRecorderDelegate {
    nonisolated func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        let id = ObjectIdentifier(recorder)
        Task { @MainActor [weak self] in self?.gravadorParouSozinho(id, ok: false) }
    }

    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        let id = ObjectIdentifier(recorder)
        Task { @MainActor [weak self] in self?.gravadorParouSozinho(id, ok: flag) }
    }
}
