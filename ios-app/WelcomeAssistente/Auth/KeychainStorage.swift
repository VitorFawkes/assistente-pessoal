import Foundation
import Security

/// Wrapper minimalista sobre Security framework pra ler/gravar/apagar
/// strings no Keychain. Usado pra persistir o session_token entre launches.
enum KeychainStorage {
    static let service = "br.com.ttars"

    enum Key: String {
        case sessionToken = "session_token"
        case userId       = "user_id"
        case userName     = "user_name"
        case userEmail    = "user_email"
    }

    @discardableResult
    static func set(_ value: String?, for key: Key) -> Bool {
        let baseQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
        ]

        SecItemDelete(baseQuery as CFDictionary)
        guard let value, let data = value.data(using: .utf8) else { return true }

        var add = baseQuery
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }

    static func get(_ key: Key) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func clearAll() {
        for key in [Key.sessionToken, .userId, .userName, .userEmail] {
            set(nil, for: key)
        }
    }
}
