import Foundation

enum Configuration {
    static let baseURL: URL = {
        guard
            let raw = Bundle.main.object(forInfoDictionaryKey: "WelcomeBaseURL") as? String,
            let url = URL(string: raw),
            !raw.isEmpty
        else {
            fatalError("WelcomeBaseURL não definido no Info.plist — configure no .xcconfig")
        }
        return url
    }()

    static let ingestURL: URL = {
        guard
            let raw = Bundle.main.object(forInfoDictionaryKey: "WelcomeIngestURL") as? String,
            let url = URL(string: raw),
            !raw.isEmpty
        else {
            fatalError("WelcomeIngestURL não definido no Info.plist — configure no .xcconfig")
        }
        return url
    }()

    static let appVersion: String =
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0.0"

    static let buildNumber: String =
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String) ?? "0"
}
