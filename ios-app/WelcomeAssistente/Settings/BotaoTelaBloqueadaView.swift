import SwiftUI

/// Passo a passo para gravar sem desbloquear: botão na tela bloqueada, botão de Ação e Siri.
struct BotaoTelaBloqueadaView: View {
    var body: some View {
        List {
            Section {
                passo(1, "Na tela bloqueada, segure o dedo num lugar vazio.")
                passo(2, "Toque em Personalizar e depois em Tela Bloqueada.")
                passo(3, "Embaixo, toque no − da lanterna ou da câmera.")
                passo(4, "Toque no + que aparece no lugar e procure Ações.")
                passo(5, "Escolha \"Gravar ou pausar reunião\" e toque em OK.")
            } header: {
                Text("Botão na tela bloqueada")
            } footer: {
                Text("Um toque grava. Outro toque pausa. Enquanto grava, a tela bloqueada mostra o tempo com Pausar e Parar.")
            }

            Section {
                passo(1, "Abra os Ajustes do iPhone e toque em Botão de Ação.")
                passo(2, "Passe para o lado até Controles e toque em Escolher um Controle.")
                passo(3, "Procure Ações e escolha \"Gravar ou pausar reunião\".")
            } header: {
                Text("Botão de Ação (lateral)")
            } footer: {
                Text("Só nos iPhones que têm o botão de Ação.")
            }

            Section {
                Text("\"E aí Siri, gravar reunião no Ações\"")
                Text("\"E aí Siri, pausar gravação no Ações\"")
                Text("\"E aí Siri, parar gravação no Ações\"")
            } header: {
                Text("Pela Siri")
            }
        }
        .navigationTitle("Gravar sem abrir")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func passo(_ n: Int, _ texto: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("\(n).").fontWeight(.semibold).foregroundStyle(.tint)
            Text(texto)
        }
    }
}
