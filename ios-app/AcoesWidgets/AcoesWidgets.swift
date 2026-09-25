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
                .activitySystemActionForegroundColor(.red)
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
                    .frame(maxWidth: 52)
            } minimal: {
                Image(systemName: icone(estado)).foregroundStyle(cor(estado))
            }
        }
    }
}

private func icone(_ estado: GravacaoAtividade.ContentState) -> String {
    estado.pausada ? "pause.fill" : "mic.fill"
}

private func cor(_ estado: GravacaoAtividade.ContentState) -> Color {
    estado.pausada ? .orange : .red
}

private struct TelaBloqueada: View {
    let estado: GravacaoAtividade.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label(estado.pausada ? "Gravação pausada" : "Gravando reunião", systemImage: icone(estado))
                    .font(.headline)
                    .foregroundStyle(cor(estado))
                Spacer()
                Relogio(estado: estado).font(.title3.monospacedDigit())
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
                .tint(.red)
            } else {
                Button(intent: PausarGravacaoIntent()) {
                    Label("Pausar", systemImage: "pause.fill").frame(maxWidth: .infinity)
                }
                .tint(.orange)
            }
            Button(intent: PararGravacaoIntent()) {
                Label("Parar", systemImage: "stop.fill").frame(maxWidth: .infinity)
            }
            .tint(.gray)
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
