import Foundation
import UIKit

/// Build-time configuration of the extension (Info.plist, filled from ios/Config/Shared.xcconfig).
enum AppConfig {
    /// Used when Info.plist has no usable FlockServerURL.
    static let fallbackServerURL = URL(string: "https://flock-poker.onrender.com")!

    /// The Flock Poker server the table is loaded from: Info.plist FlockServerURL
    /// (https://$(FLOCK_SERVER_HOST)).
    static let serverURL: URL = {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "FlockServerURL") as? String else {
            return fallbackServerURL
        }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed),
              url.scheme?.lowercased() == "https",
              let host = url.host, !host.isEmpty else {
            return fallbackServerURL
        }
        return url
    }()

    /// "host" or "host:port" of `serverURL`, for RoomLink.isAllowed / roomId(from:serverHost:).
    static let serverHost: String = {
        let host = serverURL.host ?? "flock-poker.onrender.com"
        if let port = serverURL.port {
            return "\(host):\(port)"
        }
        return host
    }()
}

/// Colours of the web table (src/client/styles/base.css tokens).
enum Theme {
    static let night = UIColor(hex: 0x1D1150)
    static let night2 = UIColor(hex: 0x2F1880)
    static let sky1 = UIColor(hex: 0x4F2FD8)
    static let sky2 = UIColor(hex: 0x7B3FF2)
    static let pink = UIColor(hex: 0xFF5FA2)
    static let ink = UIColor(hex: 0x241A4A)
    static let yellow = UIColor(hex: 0xFFC83D)
    static let yellowDark = UIColor(hex: 0xD99A00)
    static let felt1 = UIColor(hex: 0x43D886)
    static let felt2 = UIColor(hex: 0x23AD5F)
    static let felt3 = UIColor(hex: 0x168646)
    static let rail = UIColor(hex: 0xFF7A45)
    static let railDark = UIColor(hex: 0xC2410C)
    static let red = UIColor(hex: 0xFF5A5F)
    static let blue = UIColor(hex: 0x3B9CFF)
    static let purple = UIColor(hex: 0x8B5CF6)

    /// System font with the rounded design (falls back to the regular system font).
    static func roundedFont(size: CGFloat, weight: UIFont.Weight) -> UIFont {
        let base = UIFont.systemFont(ofSize: size, weight: weight)
        if let descriptor = base.fontDescriptor.withDesign(.rounded) {
            return UIFont(descriptor: descriptor, size: size)
        }
        return base
    }
}

extension UIColor {
    /// 0xRRGGBB
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        let r = CGFloat((hex >> 16) & 0xFF) / 255
        let g = CGFloat((hex >> 8) & 0xFF) / 255
        let b = CGFloat(hex & 0xFF) / 255
        self.init(red: r, green: g, blue: b, alpha: alpha)
    }
}
