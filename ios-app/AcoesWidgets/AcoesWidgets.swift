import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

@main
struct AcoesWidgets: WidgetBundle {
    var body: some Widget {
        GravacaoAoVivo()
        GravarControle()
    }
}

/// Botão da tela bloqueada, da Central de Controle e do botão de Ação.
struct GravarControle: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "br.com.ttars.gravar") {
            ControlWidgetButton(action: GravarOuPausarIntent()) {
                Label("Gravar reunião", systemImage: "mic.fill")
            }
        }
        .displayName("Gravar ou pausar reunião")
        .description("Um toque grava. Outro toque pausa.")
    }
}

/// A gravação na tela bloqueada e na Ilha Dinâmica, com Pausar/Continuar e Parar.
struct GravacaoAoVivo: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: GravacaoAtividade.self) { contexto in
            TelaBloqueada(estado: contexto.state)
                .activityBackgroundTint(Estilo.espaco.opacity(0.92))
                .activitySystemActionForegroundColor(Estilo.ouro)
        } dynamicIsland: { contexto in
            let estado = contexto.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(estado.pausada ? "Pausada" : "Gravando", systemImage: icone(estado))
                        .foregroundStyle(cor(estado))
                        .font(.headline)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Relogio(estado: estado).font(.headline.monospacedDigit())
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Botoes(estado: estado)
                }
            } compactLeading: {
                Image(systemName: icone(estado)).foregroundStyle(cor(estado))
            } compactTrailing: {
                Relogio(estado: estado)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(Estilo.ouro)
                    .frame(maxWidth: 52)
            } minimal: {
                Image(systemName: icone(estado)).foregroundStyle(cor(estado))
            }
            .keylineTint(Estilo.ouro)
        }
    }
}

private func icone(_ estado: GravacaoAtividade.ContentState) -> String {
    estado.pausada ? "pause.fill" : "mic.fill"
}

private func cor(_ estado: GravacaoAtividade.ContentState) -> Color {
    estado.pausada ? Estilo.ouro : Estilo.gravando
}

private struct TelaBloqueada: View {
    let estado: GravacaoAtividade.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                ZStack {
                    AnelGargantua(espessura: 2.6)
                    Circle().fill(estado.pausada ? Estilo.ouro : Estilo.gravando).frame(width: 9, height: 9)
                }
                .frame(width: 28, height: 28)
                VStack(alignment: .leading, spacing: 1) {
                    Text("CASE")
                        .font(.caption2.weight(.semibold))
                        .tracking(3)
                        .foregroundStyle(.white.opacity(0.55))
                    Text(estado.pausada ? "Gravação pausada" : "Gravando reunião")
                        .font(.headline)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                Spacer(minLength: 8)
                Relogio(estado: estado)
                    .font(.system(.title2, design: .monospaced).weight(.light))
                    .foregroundStyle(estado.pausada ? Estilo.ouro : .white)
                    .multilineTextAlignment(.trailing)
                    .frame(width: 96, alignment: .trailing)
            }
            Botoes(estado: estado)
        }
        .padding()
    }
}

private struct Botoes: View {
    let estado: GravacaoAtividade.ContentState

    var body: some View {
        HStack(spacing: 10) {
            if estado.pausada {
                Button(intent: GravarReuniaoIntent()) {
                    Label("Continuar", systemImage: "mic.fill").frame(maxWidth: .infinity)
                }
                .tint(Estilo.ouro)
                .foregroundStyle(Estilo.tinta)
            } else {
                Button(intent: PausarGravacaoIntent()) {
                    Label("Pausar", systemImage: "pause.fill").frame(maxWidth: .infinity)
                }
                .tint(Color.white.opacity(0.16))
                .foregroundStyle(.white)
            }
            Button(intent: PararGravacaoIntent()) {
                Label("Parar", systemImage: "stop.fill").frame(maxWidth: .infinity)
            }
            .tint(Color.white.opacity(0.16))
            .foregroundStyle(.white)
        }
        .buttonStyle(.borderedProminent)
        .font(.subheadline.weight(.semibold))
    }
}

/// Gravando: conta sozinho. Pausada: mostra o tempo parado.
private struct Relogio: View {
    let estado: GravacaoAtividade.ContentState

    var body: some View {
        if estado.pausada {
            Text(Duration.seconds(estado.segundos).formatted(.time(pattern: estado.segundos >= 3600 ? .hourMinuteSecond : .minuteSecond)))
        } else {
            Text(timerInterval: estado.desde...Date.distantFuture, countsDown: false)
        }
    }
}
