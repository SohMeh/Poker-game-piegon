import FlockKit
import UIKit

/// Draws the picture at the top of a game bubble: a felt table with a couple of cards and chips, a
/// badge for what happened, the bubble title and the table's stakes.
enum BubbleImageRenderer {
    /// Points; rendered at `scale` (900 x 600 pixels).
    static let size = CGSize(width: 600, height: 400)
    static let scale: CGFloat = 1.5

    static func image(for info: BubbleInfo, kind: BubbleKind) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = scale
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        return renderer.image { context in
            BubbleImageRenderer.draw(info: info, kind: kind, in: context.cgContext)
        }
    }

    // MARK: - Drawing

    private static func draw(info: BubbleInfo, kind: BubbleKind, in cg: CGContext) {
        let bounds = CGRect(origin: .zero, size: size)
        let colorSpace = CGColorSpaceCreateDeviceRGB()

        // Purple backdrop (the app's sky gradient).
        if let sky = CGGradient(
            colorsSpace: colorSpace,
            colors: [Theme.sky1.cgColor, Theme.sky2.cgColor, Theme.pink.cgColor] as CFArray,
            locations: [0, 0.6, 1]
        ) {
            cg.drawLinearGradient(sky, start: .zero, end: CGPoint(x: size.width, y: size.height), options: [])
        }

        // The table: orange rail around a green felt with a soft spotlight.
        let railRect = bounds.insetBy(dx: 18, dy: 18)
        let rail = UIBezierPath(roundedRect: railRect, cornerRadius: 150)
        Theme.railDark.setFill()
        UIBezierPath(roundedRect: railRect.offsetBy(dx: 0, dy: 6), cornerRadius: 150).fill()
        Theme.rail.setFill()
        rail.fill()

        let feltRect = railRect.insetBy(dx: 16, dy: 16)
        let felt = UIBezierPath(roundedRect: feltRect, cornerRadius: 134)
        cg.saveGState()
        felt.addClip()
        if let spot = CGGradient(
            colorsSpace: colorSpace,
            colors: [Theme.felt1.cgColor, Theme.felt2.cgColor, Theme.felt3.cgColor] as CFArray,
            locations: [0, 0.55, 1]
        ) {
            let center = CGPoint(x: feltRect.midX, y: feltRect.midY - 30)
            cg.drawRadialGradient(
                spot,
                startCenter: center,
                startRadius: 0,
                endCenter: center,
                endRadius: feltRect.width * 0.62,
                options: [.drawsAfterEndLocation]
            )
        }
        cg.restoreGState()
        UIColor(white: 1, alpha: 0.18).setStroke()
        let line = UIBezierPath(roundedRect: feltRect.insetBy(dx: 14, dy: 14), cornerRadius: 120)
        line.lineWidth = 3
        line.stroke()

        // Cards and chips on the right.
        drawCard(rank: "A", suit: "♠", color: Theme.ink, center: CGPoint(x: 450, y: 165), angle: -0.16, in: cg)
        drawCard(rank: "K", suit: "♥", color: UIColor(hex: 0xE5304C), center: CGPoint(x: 505, y: 175), angle: 0.14, in: cg)
        drawChipStack(colors: [Theme.red, Theme.red, Theme.red], center: CGPoint(x: 430, y: 292), in: cg)
        drawChipStack(colors: [Theme.blue, Theme.blue], center: CGPoint(x: 500, y: 302), in: cg)

        // Text on the left.
        let textLeft: CGFloat = 70
        let textWidth: CGFloat = 320

        let badge = badgeText(for: kind)
        let badgeFont = Theme.roundedFont(size: 22, weight: .black)
        let badgeAttributes: [NSAttributedString.Key: Any] = [
            .font: badgeFont,
            .foregroundColor: Theme.ink,
            .kern: 1.2,
        ]
        let badgeSize = (badge as NSString).size(withAttributes: badgeAttributes)
        let badgeRect = CGRect(x: textLeft, y: 78, width: min(badgeSize.width + 30, textWidth), height: badgeSize.height + 12)
        badgeColor(for: kind).setFill()
        UIBezierPath(roundedRect: badgeRect, cornerRadius: badgeRect.height / 2).fill()
        (badge as NSString).draw(
            in: badgeRect.insetBy(dx: 15, dy: 6),
            withAttributes: badgeAttributes
        )

        let shadow = NSShadow()
        shadow.shadowColor = UIColor(white: 0, alpha: 0.3)
        shadow.shadowOffset = CGSize(width: 0, height: 3)
        shadow.shadowBlurRadius = 0

        let titleStyle = NSMutableParagraphStyle()
        titleStyle.lineBreakMode = .byWordWrapping
        titleStyle.lineSpacing = 0
        let titleAttributes: [NSAttributedString.Key: Any] = [
            .font: Theme.roundedFont(size: 42, weight: .black),
            .foregroundColor: UIColor.white,
            .paragraphStyle: titleStyle,
            .shadow: shadow,
        ]
        let titleRect = CGRect(x: textLeft, y: badgeRect.maxY + 14, width: textWidth, height: 112)
        (info.title as NSString).draw(
            with: titleRect,
            options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
            attributes: titleAttributes,
            context: nil
        )

        let detailAttributes: [NSAttributedString.Key: Any] = [
            .font: Theme.roundedFont(size: 22, weight: .heavy),
            .foregroundColor: UIColor(white: 1, alpha: 0.92),
        ]
        let detailRect = CGRect(x: textLeft, y: 286, width: textWidth, height: 32)
        (stakesLine(info) as NSString).draw(
            with: detailRect,
            options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
            attributes: detailAttributes,
            context: nil
        )

        let brandAttributes: [NSAttributedString.Key: Any] = [
            .font: Theme.roundedFont(size: 16, weight: .heavy),
            .foregroundColor: UIColor(white: 1, alpha: 0.7),
            .kern: 1.5,
        ]
        ("FLOCK POKER" as NSString).draw(at: CGPoint(x: textLeft, y: 322), withAttributes: brandAttributes)
    }

    private static func drawCard(rank: String, suit: String, color: UIColor, center: CGPoint, angle: CGFloat, in cg: CGContext) {
        let cardSize = CGSize(width: 88, height: 122)
        cg.saveGState()
        cg.translateBy(x: center.x, y: center.y)
        cg.rotate(by: angle)
        let rect = CGRect(x: -cardSize.width / 2, y: -cardSize.height / 2, width: cardSize.width, height: cardSize.height)
        UIColor(white: 0, alpha: 0.22).setFill()
        UIBezierPath(roundedRect: rect.offsetBy(dx: 0, dy: 6), cornerRadius: 12).fill()
        UIColor.white.setFill()
        UIBezierPath(roundedRect: rect, cornerRadius: 12).fill()

        let rankAttributes: [NSAttributedString.Key: Any] = [
            .font: Theme.roundedFont(size: 38, weight: .black),
            .foregroundColor: color,
        ]
        (rank as NSString).draw(at: CGPoint(x: rect.minX + 9, y: rect.minY + 2), withAttributes: rankAttributes)
        let suitAttributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: 50, weight: .bold),
            .foregroundColor: color,
        ]
        let suitSize = (suit as NSString).size(withAttributes: suitAttributes)
        (suit as NSString).draw(
            at: CGPoint(x: rect.maxX - suitSize.width - 8, y: rect.maxY - suitSize.height - 2),
            withAttributes: suitAttributes
        )
        cg.restoreGState()
    }

    private static func drawChipStack(colors: [UIColor], center: CGPoint, in cg: CGContext) {
        let radius: CGFloat = 30
        let chipHeight: CGFloat = 9
        for (index, color) in colors.enumerated() {
            let y = center.y - CGFloat(index) * chipHeight
            let edge = CGRect(x: center.x - radius, y: y - radius * 0.5 + 4, width: radius * 2, height: radius)
            color.withAlphaComponent(0.75).setFill()
            UIBezierPath(ovalIn: edge).fill()
            let top = CGRect(x: center.x - radius, y: y - radius * 0.5, width: radius * 2, height: radius)
            color.setFill()
            UIBezierPath(ovalIn: top).fill()
            let ring = UIBezierPath(ovalIn: top.insetBy(dx: 5, dy: 3))
            ring.lineWidth = 3
            let dashes: [CGFloat] = [8, 7]
            ring.setLineDash(dashes, count: dashes.count, phase: 0)
            UIColor.white.setStroke()
            ring.stroke()
        }
    }

    // MARK: - Copy

    static func badgeText(for kind: BubbleKind) -> String {
        switch kind {
        case .invite: return "JOIN THE GAME"
        case .gameStarted: return "GAME ON"
        case .buyBackRequested: return "VOTE NEEDED"
        case .yourTurn: return "YOUR TURN"
        case .gameOver: return "GAME OVER"
        case .rematch: return "REMATCH"
        }
    }

    private static func badgeColor(for kind: BubbleKind) -> UIColor {
        switch kind {
        case .invite, .rematch: return Theme.yellow
        case .gameStarted: return UIColor(hex: 0xA9E34B)
        case .buyBackRequested: return UIColor(hex: 0xFFB34A)
        case .yourTurn: return UIColor(hex: 0x7FD6FF)
        case .gameOver: return UIColor(hex: 0xFFD36E)
        }
    }

    /// "10/20 · buy-in 2,000 · 3/9" (+ " · #12" during a game).
    static func stakesLine(_ info: BubbleInfo) -> String {
        var parts = [
            "\(chips(info.smallBlind))/\(chips(info.bigBlind))",
            "buy-in \(chips(info.buyIn))",
            "\(info.seated)/\(info.maxPlayers)",
        ]
        if info.handNumber > 0 {
            parts.append("#\(info.handNumber)")
        }
        return parts.joined(separator: " · ")
    }

    private static func chips(_ value: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: "en_US")
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }
}
