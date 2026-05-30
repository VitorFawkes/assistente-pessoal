import UIKit

/// Captura o completion handler que o iOS entrega quando relança o app pra
/// finalizar eventos de uma background `URLSession` (uploads grandes que
/// terminaram com o app suspenso/encerrado). Sem isso, o iOS pode penalizar
/// futuras transferências em background.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        guard identifier == BackgroundUploader.sessionIdentifier else {
            completionHandler()
            return
        }
        // Re-anexa a sessão (recria o delegate) e guarda o handler — chamado em
        // urlSessionDidFinishEvents quando todos os eventos forem entregues.
        BackgroundUploader.shared.backgroundCompletionHandler = completionHandler
        BackgroundUploader.shared.activate()
    }
}
