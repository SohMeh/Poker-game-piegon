import FlockKit
import UIKit
import WebKit

protocol TableWebViewControllerDelegate: AnyObject {
    /// A bridge event arrived from the page (already origin-checked and decoded).
    func tableWebView(_ controller: TableWebViewController, didReceive event: BridgeEvent)
}

/// Forwards script messages to a weakly held target. WKUserContentController retains its message
/// handlers, so registering the view controller directly would keep it alive forever.
final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?

    init(target: WKScriptMessageHandler) {
        self.target = target
        super.init()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}

/// Hosts the web poker table in a WKWebView. Created once and kept alive across compact / expanded
/// transitions, so the table's socket connection and state survive resizing.
final class TableWebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    weak var delegate: TableWebViewControllerDelegate?

    let serverURL: URL
    let serverHost: String

    private let contentController = WKUserContentController()
    private var webView: WKWebView!
    private let overlay = LoadingOverlayView()

    /// The last URL handed to `load(_:info:)` (for Retry and before the web view reports a URL).
    private(set) var requestedURL: URL?
    private var lastInfo: NativeInfo?
    /// A page was requested at least once.
    var hasRequestedPage: Bool { return requestedURL != nil }
    /// The last load failed and the error overlay is showing.
    private(set) var hasError = false
    /// The page sent `ready` (the bridge is live) since the last load.
    private(set) var isPageReady = false

    init(serverURL: URL, serverHost: String) {
        self.serverURL = serverURL
        self.serverHost = serverHost
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func loadView() {
        let container = UIView()
        container.backgroundColor = Theme.night

        contentController.add(WeakScriptMessageHandler(target: self), name: BridgeConstants.handlerName)

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = contentController
        // Persistent storage: the per-room session token lives in localStorage, so reopening a
        // bubble brings the player back to the same seat.
        configuration.websiteDataStore = WKWebsiteDataStore.default()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = Theme.night
        webView.scrollView.backgroundColor = Theme.night
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        #if DEBUG
        if #available(iOS 16.4, *) {
            // Safari > Develop > <device> can inspect the table in debug builds.
            webView.isInspectable = true
        }
        #endif
        webView.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(webView)

        overlay.translatesAutoresizingMaskIntoConstraints = false
        overlay.onRetry = { [weak self] in
            self?.retry()
        }
        container.addSubview(overlay)

        let safe = container.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: safe.topAnchor),
            webView.bottomAnchor.constraint(equalTo: safe.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: safe.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: safe.trailingAnchor),
            overlay.topAnchor.constraint(equalTo: container.topAnchor),
            overlay.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            overlay.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            overlay.trailingAnchor.constraint(equalTo: container.trailingAnchor),
        ])

        self.webView = webView
        self.view = container
        overlay.isHidden = true
    }

    // MARK: - Loading

    /// Loads `url`, injecting `info` as window.__FLOCK_NATIVE__ before any page script runs.
    func load(_ url: URL, info: NativeInfo) {
        loadViewIfNeeded()
        requestedURL = url
        lastInfo = info
        installUserScript(info: info)
        isPageReady = false
        hasError = false
        showLoading()
        let request = URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 90)
        webView.load(request)
    }

    /// Reloads the last requested page (after an error), with a fresh NativeInfo if given.
    func retry(info: NativeInfo? = nil) {
        guard let url = requestedURL else { return }
        load(url, info: info ?? lastInfo ?? NativeInfo(name: nil, presentation: .expanded))
    }

    private func installUserScript(info: NativeInfo) {
        contentController.removeAllUserScripts()
        let script = WKUserScript(
            source: NativeBridge.injectionScript(info: info),
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        contentController.addUserScript(script)
    }

    /// Room code of the table on screen (from the page URL, which follows client-side navigation).
    var currentRoomId: String? {
        if isViewLoaded, let url = webView.url {
            return RoomLink.roomId(from: url, serverHost: serverHost)
        }
        if let url = requestedURL {
            return RoomLink.roomId(from: url, serverHost: serverHost)
        }
        return nil
    }

    /// Delivers a NativeToWeb payload to the page as a `flock:native` CustomEvent.
    func send(_ payload: NativeToWeb) {
        guard isViewLoaded, hasRequestedPage else { return }
        webView.evaluateJavaScript(NativeBridge.dispatchScript(payload), completionHandler: nil)
    }

    // MARK: - Overlay

    private func showLoading() {
        cancelSlowLoadHint()
        overlay.showLoading(message: "Opening the table…")
        overlay.isHidden = false
        perform(#selector(showSlowLoadHint), with: nil, afterDelay: 5)
    }

    /// The free Render instance sleeps when idle; the first request can take up to a minute.
    @objc private func showSlowLoadHint() {
        guard !overlay.isHidden, !hasError else { return }
        overlay.showLoading(message: "Waking up the poker server…\nThis can take up to a minute.")
    }

    private func cancelSlowLoadHint() {
        NSObject.cancelPreviousPerformRequests(withTarget: self, selector: #selector(showSlowLoadHint), object: nil)
    }

    private func hideOverlay() {
        cancelSlowLoadHint()
        overlay.isHidden = true
    }

    private func showError(_ error: Error) {
        cancelSlowLoadHint()
        hasError = true
        let nsError = error as NSError
        let message: String
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorNotConnectedToInternet {
            message = "You’re offline. Check your connection and try again."
        } else if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorTimedOut {
            message = "The poker server didn’t answer in time."
        } else {
            message = "Couldn’t open the table."
        }
        overlay.showError(message: message)
        overlay.isHidden = false
    }

    /// Cancelled navigations (a newer load replaced it, or our policy cancelled it) are not errors.
    private func isBenignNavigationError(_ error: Error) -> Bool {
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return true }
        // WebKitErrorFrameLoadInterruptedByPolicyChange
        if nsError.domain == "WebKitErrorDomain" && nsError.code == 102 { return true }
        return false
    }

    // MARK: - WKScriptMessageHandler

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == BridgeConstants.handlerName else { return }
        // Only the table page itself may talk to native: main frame, https, exactly our server.
        guard message.frameInfo.isMainFrame else { return }
        let origin = message.frameInfo.securityOrigin
        var components = URLComponents()
        components.scheme = origin.`protocol`
        components.host = origin.host
        if origin.port != 0 {
            components.port = origin.port
        }
        guard let originURL = components.url, RoomLink.isAllowed(originURL, serverHost: serverHost) else { return }

        let event: BridgeEvent
        do {
            event = try NativeBridge.decode(any: message.body)
        } catch {
            #if DEBUG
            print("[FlockPoker] ignored a malformed bridge message: \(error)")
            #endif
            return
        }
        if case .ready = event {
            isPageReady = true
            hasError = false
            hideOverlay()
        }
        delegate?.tableWebView(self, didReceive: event)
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if RoomLink.isAllowed(url, serverHost: serverHost) {
            decisionHandler(.allow)
            return
        }
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        let scheme = url.scheme?.lowercased() ?? ""
        if !isMainFrame && (scheme == "about" || scheme == "blob" || scheme == "data") {
            decisionHandler(.allow)
            return
        }
        // Everything else stays out of the extension. A link the player tapped is handed to the
        // system (Safari / the app for sms: and mailto: links) when Messages allows it.
        decisionHandler(.cancel)
        if navigationAction.navigationType == .linkActivated {
            openOutside(url)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        hasError = false
        hideOverlay()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if isBenignNavigationError(error) { return }
        showError(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if isBenignNavigationError(error) { return }
        showError(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // The page's process was killed (memory pressure): bring the page back. Reload the page that
        // was on screen (after "New game" the player has moved on from the create page to /g/<ID>).
        if let current = webView.url, RoomLink.isAllowed(current, serverHost: serverHost) {
            load(current, info: lastInfo ?? NativeInfo(name: nil, presentation: .expanded))
        } else {
            retry()
        }
    }

    // MARK: - WKUIDelegate

    /// target=_blank links and window.open: our own pages open in place, the rest go outside.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if RoomLink.isAllowed(url, serverHost: serverHost) {
                webView.load(URLRequest(url: url))
            } else {
                openOutside(url)
            }
        }
        return nil
    }

    private func openOutside(_ url: URL) {
        guard let scheme = url.scheme?.lowercased(), ["https", "http", "sms", "mailto", "tel"].contains(scheme) else { return }
        // This is a child of the principal MessagesViewController, which owns the extension context.
        (extensionContext ?? parent?.extensionContext)?.open(url, completionHandler: nil)
    }
}

/// Spinner / error card shown over the web view while the table loads.
final class LoadingOverlayView: UIView {
    var onRetry: (() -> Void)?

    private let spinner = UIActivityIndicatorView(style: .large)
    private let label = UILabel()
    private let retryButton = UIButton(type: .system)

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = Theme.night

        spinner.color = .white
        spinner.hidesWhenStopped = true

        label.textColor = UIColor(white: 1, alpha: 0.9)
        label.font = Theme.roundedFont(size: 17, weight: .bold)
        label.numberOfLines = 0
        label.textAlignment = .center

        var config = UIButton.Configuration.filled()
        config.title = "Try again"
        config.baseBackgroundColor = Theme.yellow
        config.baseForegroundColor = Theme.ink
        config.cornerStyle = .capsule
        config.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 28, bottom: 12, trailing: 28)
        retryButton.configuration = config
        retryButton.addAction(UIAction { [weak self] _ in
            self?.onRetry?()
        }, for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [spinner, label, retryButton])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: safeAreaLayoutGuide.centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -24),
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    func showLoading(message: String) {
        label.text = message
        spinner.startAnimating()
        retryButton.isHidden = true
    }

    func showError(message: String) {
        label.text = message
        spinner.stopAnimating()
        retryButton.isHidden = false
    }
}
