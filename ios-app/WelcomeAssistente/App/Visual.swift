import SwiftUI

/// Fundo de todas as telas: o espaço do ícone, com estrelas fixas.
struct FundoEspaco: View {
    var body: some View {
        ZStack {
            LinearGradient(colors: [Estilo.espacoTopo, Estilo.espaco, Estilo.espacoFundo],
                           startPoint: .top, endPoint: .bottom)
            RadialGradient(colors: [Color(red: 0.30, green: 0.40, blue: 0.62).opacity(0.22), .clear],
                           center: UnitPoint(x: 0.5, y: 0.28), startRadius: 0, endRadius: 420)
            Estrelas()
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}

private struct Estrelas: View {
    var body: some View {
        Canvas { contexto, tamanho in
            var sorteio = SorteioFixo(semente: 7)
            for _ in 0..<80 {
                let x = sorteio.proximo() * tamanho.width
                let y = sorteio.proximo() * tamanho.height
                let raio = 0.4 + sorteio.proximo() * 1.0
                let brilho = 0.12 + sorteio.proximo() * 0.5
                contexto.fill(Path(ellipseIn: CGRect(x: x, y: y, width: raio * 2, height: raio * 2)),
                              with: .color(.white.opacity(brilho)))
            }
        }
    }
}

/// Sempre as mesmas estrelas no mesmo lugar.
private struct SorteioFixo {
    var estado: UInt64
    init(semente: UInt64) { estado = semente }
    mutating func proximo() -> Double {
        estado = estado &* 6364136223846793005 &+ 1442695040888963407
        return Double(estado >> 11) / Double(UInt64(1) << 53)
    }
}

/// O robô do ícone, "andando" (os blocos do meio mais altos). Gravando, os blocos
/// acompanham a voz e a luz da telinha acende com o som.
struct RoboCASE: View {
    var nivel: Double = 0
    var gravando = false

    private let passo: [CGFloat] = [1, -1, -1, 1]
    private let escuta: [CGFloat] = [0.55, 1.0, 0.8, 0.4]

    var body: some View {
        GeometryReader { geo in
            let vao = geo.size.width * 0.035
            let largura = (geo.size.width - vao * 3) / 4
            let altura = geo.size.height * 0.88
            let degrau = geo.size.height * 0.035
            HStack(spacing: vao) {
                ForEach(0..<4, id: \.self) { i in
                    BlocoDoRobo(comTela: i == 1, gravando: gravando, nivel: nivel)
                        .frame(width: largura, height: altura)
                        .offset(y: passo[i] * degrau - (gravando ? CGFloat(nivel) * degrau * 1.8 * escuta[i] : 0))
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .animation(.easeOut(duration: 0.15), value: nivel)
        }
    }
}

private struct BlocoDoRobo: View {
    let comTela: Bool
    let gravando: Bool
    let nivel: Double

    var body: some View {
        GeometryReader { geo in
            let l = geo.size.width, a = geo.size.height
            ZStack(alignment: .top) {
                LinearGradient(colors: [Estilo.metalClaro, Estilo.metalEscuro], startPoint: .top, endPoint: .bottom)
                HStack(spacing: 0) {
                    Color.white.opacity(0.35).frame(width: max(1, l * 0.03))
                    Spacer(minLength: 0)
                    Color.black.opacity(0.35).frame(width: max(1, l * 0.045))
                }
                Rectangle().fill(Color(white: 0.14)).frame(height: max(1.5, a * 0.014)).offset(y: a * 0.24)
                Rectangle().fill(Color(white: 0.22).opacity(0.7)).frame(height: max(0.8, a * 0.005)).offset(y: a * 0.63)
                if comTela {
                    TelaDoRobo(gravando: gravando, nivel: nivel)
                        .frame(width: l * 0.78, height: a * 0.12)
                        .offset(y: a * 0.045)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: l * 0.06))
        }
    }
}

private struct TelaDoRobo: View {
    let gravando: Bool
    let nivel: Double

    var body: some View {
        GeometryReader { geo in
            let l = geo.size.width, a = geo.size.height
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: l * 0.06).fill(Color(red: 0.03, green: 0.035, blue: 0.05))
                Circle()
                    .fill(Estilo.gravando.opacity(gravando ? 0.65 + 0.35 * nivel : 0.35))
                    .shadow(color: Estilo.gravando.opacity(gravando ? 0.9 : 0), radius: a * 0.18)
                    .frame(width: a * 0.3, height: a * 0.3)
                    .offset(x: l * 0.12, y: a * 0.14)
                Capsule().fill(Color.white.opacity(0.8)).frame(width: l * 0.4, height: a * 0.1).offset(x: l * 0.46, y: a * 0.24)
                Capsule().fill(Color.white.opacity(0.5)).frame(width: l * 0.74, height: a * 0.09).offset(x: l * 0.12, y: a * 0.52)
                Capsule().fill(Color.white.opacity(0.5)).frame(width: l * 0.44, height: a * 0.09).offset(x: l * 0.12, y: a * 0.72)
            }
        }
    }
}

/// Botão principal: dourado com letra escura.
struct BotaoOuro: ButtonStyle {
    @Environment(\.isEnabled) private var ativo

    func makeBody(configuration: ButtonStyleConfiguration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(ativo ? Estilo.tinta : .white.opacity(0.4))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 15)
            .background(Capsule().fill(ativo
                ? AnyShapeStyle(LinearGradient(colors: [Estilo.ouroClaro, Estilo.ouro, Estilo.ouroForte],
                                               startPoint: .leading, endPoint: .trailing))
                : AnyShapeStyle(Estilo.placa)))
            .overlay(Capsule().stroke(ativo ? .clear : Estilo.borda))
            .shadow(color: Estilo.ouroForte.opacity(ativo ? 0.35 : 0), radius: 14, y: 4)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

/// Botão de apoio: placa translúcida com borda fina.
struct BotaoPlaca: ButtonStyle {
    func makeBody(configuration: ButtonStyleConfiguration) -> some View {
        configuration.label
            .font(.body.weight(.medium))
            .foregroundStyle(.white.opacity(0.9))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(Capsule().fill(Estilo.placa))
            .overlay(Capsule().stroke(Estilo.borda))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

/// Encolhe um pouco ao tocar (botões redondos da tela de gravar).
struct Apertar: ButtonStyle {
    func makeBody(configuration: ButtonStyleConfiguration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .animation(.spring(duration: 0.25), value: configuration.isPressed)
    }
}

extension View {
    /// Listas e formulários no fundo do espaço, com as linhas em placas.
    func listaNoEspaco() -> some View {
        scrollContentBackground(.hidden)
            .background(FundoEspaco())
    }
}
