import SwiftUI

/// Cores do CASE, as mesmas do ícone: o espaço, o anel do Gargantua e a luz de gravação do robô.
/// Usado pelo app e pela extensão (tela bloqueada).
enum Estilo {
    static let espacoTopo = Color(red: 0.07, green: 0.10, blue: 0.18)
    static let espaco = Color(red: 0.03, green: 0.045, blue: 0.08)
    static let espacoFundo = Color(red: 0.01, green: 0.015, blue: 0.035)
    static let ouroClaro = Color(red: 1.0, green: 0.96, blue: 0.86)
    static let ouro = Color(red: 1.0, green: 0.78, blue: 0.40)
    static let ouroForte = Color(red: 1.0, green: 0.60, blue: 0.18)
    static let gravando = Color(red: 1.0, green: 0.27, blue: 0.23)
    static let metalClaro = Color(red: 0.78, green: 0.79, blue: 0.81)
    static let metalEscuro = Color(red: 0.50, green: 0.53, blue: 0.56)
    static let placa = Color.white.opacity(0.06)
    static let borda = Color.white.opacity(0.10)
    /// Texto escuro em cima do dourado.
    static let tinta = Color(red: 0.10, green: 0.07, blue: 0.02)
}

/// O anel do Gargantua: forte à esquerda e sumindo à direita, o C do logo.
struct AnelGargantua: View {
    var espessura: CGFloat = 8
    var brilho: Double = 1

    var body: some View {
        ZStack {
            Circle().stroke(Self.cor, lineWidth: espessura * 2.4)
                .blur(radius: espessura * 1.6)
                .opacity(0.75 * brilho)
            Circle().stroke(Self.cor, lineWidth: espessura)
        }
    }

    static let cor = LinearGradient(stops: [
        .init(color: Estilo.ouroClaro, location: 0),
        .init(color: Estilo.ouro, location: 0.3),
        .init(color: Estilo.ouroForte.opacity(0.6), location: 0.52),
        .init(color: Estilo.ouroForte.opacity(0), location: 0.7),
    ], startPoint: .leading, endPoint: .trailing)
}
