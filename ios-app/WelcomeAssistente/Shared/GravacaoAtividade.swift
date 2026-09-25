import ActivityKit
import Foundation

/// A gravação na tela bloqueada e na Ilha Dinâmica (Atividade ao Vivo).
/// Usado pelo app (liga, atualiza, encerra) e pela extensão (desenha).
struct GravacaoAtividade: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var pausada: Bool
        /// Gravando: o relógio conta a partir daqui (agora menos o tempo já gravado).
        var desde: Date
        /// Pausada: tempo gravado até a pausa.
        var segundos: Double
    }
}
