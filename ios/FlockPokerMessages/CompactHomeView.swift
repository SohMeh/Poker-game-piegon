import FlockKit
import UIKit

/// The native screen shown in the compact (app drawer) presentation, and in the expanded one until a
/// table is opened: logo, a big "New game" button, "Back to table" when a table is loaded, and the
/// recently opened tables.
final class CompactHomeView: UIView {
    var onNewGame: (() -> Void)?
    var onBackToTable: (() -> Void)?
    var onOpenRecent: ((String) -> Void)?

    private let gradient = CAGradientLayer()
    private let scrollView = UIScrollView()
    private let stack = UIStackView()
    private let newGameButton = UIButton(type: .system)
    private let backButton = UIButton(type: .system)
    private let recentsLabel = UILabel()
    private let recentsStack = UIStackView()
    private let hintLabel = UILabel()

    override init(frame: CGRect) {
        super.init(frame: frame)
        build()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        gradient.frame = bounds
    }

    /// `currentTable`: room code of the table loaded in the web view (nil hides "Back to table").
    func update(currentTable: String?, recents: [RecentTable]) {
        if let room = currentTable {
            var config = backButton.configuration ?? UIButton.Configuration.filled()
            config.subtitle = "Table \(room)"
            backButton.configuration = config
            backButton.isHidden = false
        } else {
            backButton.isHidden = true
        }

        for view in recentsStack.arrangedSubviews {
            recentsStack.removeArrangedSubview(view)
            view.removeFromSuperview()
        }
        let others = recents.filter { $0.roomId != currentTable }
        for table in others {
            recentsStack.addArrangedSubview(makeRecentButton(table))
        }
        recentsLabel.isHidden = others.isEmpty
        recentsStack.isHidden = others.isEmpty
        hintLabel.isHidden = !others.isEmpty || currentTable != nil
    }

    // MARK: - Building

    private func build() {
        backgroundColor = Theme.night
        gradient.colors = [Theme.sky1.cgColor, Theme.sky2.cgColor, Theme.night2.cgColor]
        gradient.locations = [0, 0.55, 1]
        gradient.startPoint = CGPoint(x: 0, y: 0)
        gradient.endPoint = CGPoint(x: 1, y: 1)
        layer.insertSublayer(gradient, at: 0)

        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.alwaysBounceVertical = true
        scrollView.showsVerticalScrollIndicator = false
        addSubview(scrollView)

        stack.axis = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        scrollView.addSubview(stack)

        let safe = safeAreaLayoutGuide
        let content = scrollView.contentLayoutGuide
        let frameGuide = scrollView.frameLayoutGuide
        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: safe.topAnchor),
            scrollView.bottomAnchor.constraint(equalTo: safe.bottomAnchor),
            scrollView.leadingAnchor.constraint(equalTo: safe.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: safe.trailingAnchor),
            content.widthAnchor.constraint(equalTo: frameGuide.widthAnchor),
            stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 14),
            stack.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -14),
            stack.centerXAnchor.constraint(equalTo: content.centerXAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: content.leadingAnchor, constant: 16),
            // Keep the column readable on iPad / landscape.
            stack.widthAnchor.constraint(lessThanOrEqualToConstant: 520),
        ])
        let fullWidth = stack.widthAnchor.constraint(equalTo: frameGuide.widthAnchor, constant: -32)
        fullWidth.priority = .defaultHigh
        fullWidth.isActive = true

        stack.addArrangedSubview(makeHeader())

        newGameButton.configuration = makeButtonConfig(
            title: "New game",
            subtitle: "Start a table and invite this chat",
            systemImage: "suit.spade.fill",
            background: Theme.yellow,
            foreground: Theme.ink
        )
        newGameButton.addAction(UIAction { [weak self] _ in
            self?.onNewGame?()
        }, for: .touchUpInside)
        newGameButton.accessibilityIdentifier = "new-game"
        stack.addArrangedSubview(newGameButton)

        backButton.configuration = makeButtonConfig(
            title: "Back to table",
            subtitle: nil,
            systemImage: "arrow.up.left.and.arrow.down.right",
            background: Theme.felt2,
            foreground: .white
        )
        backButton.addAction(UIAction { [weak self] _ in
            self?.onBackToTable?()
        }, for: .touchUpInside)
        backButton.accessibilityIdentifier = "back-to-table"
        backButton.isHidden = true
        stack.addArrangedSubview(backButton)

        recentsLabel.text = "RECENT TABLES"
        recentsLabel.font = Theme.roundedFont(size: 13, weight: .heavy)
        recentsLabel.textColor = UIColor(white: 1, alpha: 0.7)
        recentsLabel.isHidden = true
        stack.addArrangedSubview(recentsLabel)
        stack.setCustomSpacing(6, after: recentsLabel)

        recentsStack.axis = .vertical
        recentsStack.spacing = 8
        recentsStack.isHidden = true
        stack.addArrangedSubview(recentsStack)

        hintLabel.text = "Tap a Flock Poker bubble in this chat to open its table."
        hintLabel.font = Theme.roundedFont(size: 14, weight: .semibold)
        hintLabel.textColor = UIColor(white: 1, alpha: 0.75)
        hintLabel.numberOfLines = 0
        hintLabel.textAlignment = .center
        stack.addArrangedSubview(hintLabel)
    }

    private func makeHeader() -> UIView {
        let logo = UIImageView(image: UIImage(named: "Logo"))
        logo.contentMode = .scaleAspectFit
        logo.layer.cornerRadius = 10
        logo.clipsToBounds = true
        logo.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            logo.widthAnchor.constraint(equalToConstant: 44),
            logo.heightAnchor.constraint(equalToConstant: 44),
        ])

        let title = UILabel()
        title.text = "Flock Poker"
        title.font = Theme.roundedFont(size: 24, weight: .black)
        title.textColor = .white

        let subtitle = UILabel()
        subtitle.text = "No-Limit Hold’em for the group chat"
        subtitle.font = Theme.roundedFont(size: 13, weight: .semibold)
        subtitle.textColor = UIColor(white: 1, alpha: 0.8)
        subtitle.adjustsFontSizeToFitWidth = true
        subtitle.minimumScaleFactor = 0.8

        let titles = UIStackView(arrangedSubviews: [title, subtitle])
        titles.axis = .vertical
        titles.spacing = 0

        let row = UIStackView(arrangedSubviews: [logo, titles])
        row.axis = .horizontal
        row.alignment = .center
        row.spacing = 12
        return row
    }

    private func makeButtonConfig(title: String, subtitle: String?, systemImage: String, background: UIColor, foreground: UIColor) -> UIButton.Configuration {
        var config = UIButton.Configuration.filled()
        config.title = title
        config.subtitle = subtitle
        config.image = UIImage(systemName: systemImage)
        config.imagePlacement = .leading
        config.imagePadding = 12
        config.titleAlignment = .leading
        config.baseBackgroundColor = background
        config.baseForegroundColor = foreground
        config.cornerStyle = .large
        config.contentInsets = NSDirectionalEdgeInsets(top: 14, leading: 18, bottom: 14, trailing: 18)
        config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = Theme.roundedFont(size: 20, weight: .heavy)
            return outgoing
        }
        config.subtitleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = Theme.roundedFont(size: 13, weight: .semibold)
            return outgoing
        }
        return config
    }

    private func makeRecentButton(_ table: RecentTable) -> UIButton {
        var config = UIButton.Configuration.filled()
        config.title = table.title
        config.subtitle = "Table \(table.roomId) · \(RelativeTime.describe(table.lastOpened))"
        config.image = UIImage(systemName: "suit.club.fill")
        config.imagePlacement = .leading
        config.imagePadding = 10
        config.titleAlignment = .leading
        config.baseBackgroundColor = UIColor(white: 1, alpha: 0.16)
        config.baseForegroundColor = .white
        config.cornerStyle = .large
        config.contentInsets = NSDirectionalEdgeInsets(top: 10, leading: 14, bottom: 10, trailing: 14)
        config.titleLineBreakMode = .byTruncatingTail
        config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = Theme.roundedFont(size: 16, weight: .bold)
            return outgoing
        }
        config.subtitleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = Theme.roundedFont(size: 12, weight: .semibold)
            return outgoing
        }
        let button = UIButton(type: .system)
        button.configuration = config
        button.contentHorizontalAlignment = .leading
        let roomId = table.roomId
        button.addAction(UIAction { [weak self] _ in
            self?.onOpenRecent?(roomId)
        }, for: .touchUpInside)
        button.accessibilityLabel = "\(table.title), table \(roomId)"
        return button
    }
}

/// "just now", "5 min ago", "yesterday"... for the recent tables list.
enum RelativeTime {
    static func describe(_ date: Date, now: Date = Date()) -> String {
        let seconds = now.timeIntervalSince(date)
        if seconds < 60 { return "just now" }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: now)
    }
}
