import FlockKit
import Messages
import UIKit

/// Principal class of the Flock Poker Messages extension (NSExtensionPrincipalClass).
///
/// - Compact (app drawer): a native home screen with "New game", "Back to table" and recent tables.
/// - Expanded: the live web table (TableWebViewController), kept alive across resizes.
/// - Tapping a Flock Poker bubble opens that bubble's table expanded.
/// - The web table asks for chat bubbles, haptics and resizes over the JS bridge (FlockKit).
final class MessagesViewController: MSMessagesAppViewController, TableWebViewControllerDelegate {
    private let serverURL = AppConfig.serverURL
    private let serverHost = AppConfig.serverHost
    private let store = UserDefaultsStore()
    private lazy var ledger = BubbleLedger(store: store)
    private lazy var recents = RecentTables(store: store)
    private lazy var names = PlayerNameStore(store: store)
    private lazy var composer = BubbleComposer(ledger: ledger)

    private let homeView = CompactHomeView()
    /// Created on first use, then kept for the life of the extension.
    private var tableController: TableWebViewController?

    // MARK: - View

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Theme.night

        homeView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(homeView)
        NSLayoutConstraint.activate([
            homeView.topAnchor.constraint(equalTo: view.topAnchor),
            homeView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            homeView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            homeView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        homeView.onNewGame = { [weak self] in
            self?.startNewGame()
        }
        homeView.onBackToTable = { [weak self] in
            self?.backToTable()
        }
        homeView.onOpenRecent = { [weak self] roomId in
            self?.openTable(roomId: roomId, title: nil)
        }
        refreshHome()
        updateVisibility(for: presentationStyle)
    }

    // MARK: - Conversation lifecycle

    override func willBecomeActive(with conversation: MSConversation) {
        super.willBecomeActive(with: conversation)
        if let message = conversation.selectedMessage {
            openSelected(message, in: conversation)
        }
        refreshHome()
        updateVisibility(for: presentationStyle)
    }

    override func didBecomeActive(with conversation: MSConversation) {
        super.didBecomeActive(with: conversation)
        // Usually handled in willBecomeActive; opening is idempotent for the table already loaded.
        if let message = conversation.selectedMessage {
            openSelected(message, in: conversation)
        }
    }

    override func didSelect(_ message: MSMessage, conversation: MSConversation) {
        super.didSelect(message, conversation: conversation)
        openSelected(message, in: conversation)
    }

    override func didReceive(_ message: MSMessage, conversation: MSConversation) {
        super.didReceive(message, conversation: conversation)
        composer.remember(message, in: conversation)
    }

    override func willResignActive(with conversation: MSConversation) {
        super.willResignActive(with: conversation)
    }

    override func didResignActive(with conversation: MSConversation) {
        super.didResignActive(with: conversation)
        // Nothing to tear down: the web view (and its table connection) stays alive so coming back
        // is instant. The system may end the extension at any time; the page's session token is in
        // persistent website data, so the next load rejoins the same seat.
    }

    override func willTransition(to presentationStyle: MSMessagesAppPresentationStyle) {
        super.willTransition(to: presentationStyle)
        if presentationStyle == .compact {
            // Show the native home right away; the web table is too cramped at drawer height.
            updateVisibility(for: .compact)
        }
    }

    override func didTransition(to presentationStyle: MSMessagesAppPresentationStyle) {
        super.didTransition(to: presentationStyle)
        updateVisibility(for: presentationStyle)
        tableController?.send(.presentation(bridgeStyle(presentationStyle)))
    }

    // MARK: - Actions

    private func startNewGame() {
        let table = ensureTableController()
        let showingHomeOrCreate = table.hasRequestedPage && !table.hasError && table.currentRoomId == nil
        if !showingHomeOrCreate {
            table.load(RoomLink.createURL(server: serverURL), info: nativeInfo(presentation: .expanded))
        }
        showTable()
    }

    private func backToTable() {
        guard let table = tableController, table.hasRequestedPage else {
            startNewGame()
            return
        }
        if table.hasError {
            table.retry(info: nativeInfo(presentation: .expanded))
        }
        showTable()
    }

    /// A bubble was tapped (or the extension opened with one selected).
    private func openSelected(_ message: MSMessage, in conversation: MSConversation) {
        composer.remember(message, in: conversation)
        guard let url = message.url, let roomId = RoomLink.roomId(from: url, serverHost: serverHost) else {
            return
        }
        openTable(roomId: roomId, title: nil)
    }

    private func openTable(roomId: String, title: String?) {
        guard let url = RoomLink.tableURL(server: serverURL, roomId: roomId) else { return }
        recents.touch(roomId: roomId, title: title)
        let table = ensureTableController()
        let alreadyOpen = table.hasRequestedPage && !table.hasError && table.currentRoomId == RoomLink.normalizeRoomId(roomId)
        if !alreadyOpen {
            table.load(url, info: nativeInfo(presentation: .expanded))
        }
        showTable()
    }

    /// Shows the web table and asks Messages for the full-height presentation.
    private func showTable() {
        refreshHome()
        tableController?.view.isHidden = false
        homeView.isHidden = true
        if presentationStyle != .expanded {
            requestPresentationStyle(.expanded)
        }
    }

    private func updateVisibility(for style: MSMessagesAppPresentationStyle) {
        let tableVisible = style == .expanded && (tableController?.hasRequestedPage ?? false)
        tableController?.view.isHidden = !tableVisible
        homeView.isHidden = tableVisible
        if !tableVisible {
            refreshHome()
        }
    }

    private func refreshHome() {
        let current = (tableController?.hasRequestedPage ?? false) ? tableController?.currentRoomId : nil
        homeView.update(currentTable: current, recents: recents.tables)
    }

    private func ensureTableController() -> TableWebViewController {
        if let existing = tableController {
            return existing
        }
        let controller = TableWebViewController(serverURL: serverURL, serverHost: serverHost)
        controller.delegate = self
        addChild(controller)
        controller.view.translatesAutoresizingMaskIntoConstraints = false
        view.insertSubview(controller.view, belowSubview: homeView)
        NSLayoutConstraint.activate([
            controller.view.topAnchor.constraint(equalTo: view.topAnchor),
            controller.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            controller.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            controller.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        controller.didMove(toParent: self)
        controller.view.isHidden = true
        tableController = controller
        return controller
    }

    private func nativeInfo(presentation: PresentationStyle) -> NativeInfo {
        return NativeInfo(name: names.name, presentation: presentation)
    }

    private func bridgeStyle(_ style: MSMessagesAppPresentationStyle) -> PresentationStyle {
        switch style {
        case .expanded:
            return .expanded
        case .compact, .transcript:
            return .compact
        @unknown default:
            return .compact
        }
    }

    // MARK: - TableWebViewControllerDelegate

    func tableWebView(_ controller: TableWebViewController, didReceive event: BridgeEvent) {
        switch event {
        case .ready:
            controller.send(.presentation(bridgeStyle(presentationStyle)))
            if let roomId = controller.currentRoomId {
                recents.touch(roomId: roomId, title: nil)
            }
            refreshHome()

        case .rememberName(let name):
            names.remember(name)

        case let .bubble(kind, mode, dedupeKey, plainLink, info):
            let request = BubbleRequest(kind: kind, mode: mode, dedupeKey: dedupeKey, plainLink: plainLink, bubble: info)
            let host = info.hostName.trimmingCharacters(in: .whitespacesAndNewlines)
            recents.touch(roomId: info.roomId, title: host.isEmpty ? nil : "\(host)’s table")
            composer.post(request, in: activeConversation) { [weak self, weak controller] outcome in
                controller?.send(outcome.result)
                if mode == .insert && outcome.inserted {
                    // Collapse so the player sees the bubble in the compose field and taps Send.
                    self?.requestPresentationStyle(.compact)
                }
            }

        case .haptic(let style):
            Haptics.play(style)

        case .presentation(let style):
            switch style {
            case .compact:
                requestPresentationStyle(.compact)
            case .expanded:
                requestPresentationStyle(.expanded)
            }

        case .unknown:
            break
        }
    }
}
