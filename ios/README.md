# Flock Poker for iMessage

This folder is the native iMessage app, which works like GamePigeon. Open a conversation, tap the
**+** (app drawer), pick **Flock Poker** and tap **New game**. A game bubble goes into the chat.
Everyone taps the bubble and the live poker table opens right inside Messages. When something
happens (the game starts, someone asks to buy back in and everyone has to vote, it's your turn while
you're away, the game ends, a rematch starts) a new bubble lands in the chat and replaces the older
one.

The table itself is the same Flock Poker web table that runs at
<https://flock-poker.onrender.com>, shown inside Messages. The server still deals the cards, keeps
everyone's hole cards secret, gives each player exactly one buy-in and runs the buy-back vote, where
everyone has to say yes before the timer runs out.

> **Friends without the app** can still play. On an iPhone, tapping a bubble from an app you don't
> have opens the App Store, not Safari, so every invite also adds the plain link: *"No app? Join in
> your browser: https://flock-poker.onrender.com/g/K7QX2M"*. That link opens the same table in Safari.

## What's in here

| Path | What it is |
| --- | --- |
| `project.yml` | [XcodeGen](https://github.com/yonaskolb/XcodeGen) spec. The Xcode project is generated from it and is not committed. |
| `Config/Shared.xcconfig` | The settings you might change: bundle id prefix, server host, signing team. |
| `FlockPokerMessages/` | The Messages extension (Swift, UIKit). It has the compact home screen, the web table in a `WKWebView`, the bubble composer, the bubble artwork and haptics. |
| `FlockKit/` | A Swift package with the pure logic and its unit tests: the web/native bridge contract, room links, bubble de-duplication and recent tables. |
| `../scripts/render-imessage-icons.mjs` | Renders the iMessage icons in `FlockPokerMessages/Assets.xcassets` from `public/icon.svg`. |

The bridge between the web table and the extension is defined in
`src/client/native/bridgeTypes.ts`. Both sides test against the same fixture,
`FlockKit/Tests/FlockKitTests/Fixtures/bridge-events.json`.

## Install it on your iPhone (free Apple ID)

You need a Mac, an iPhone and a USB cable. You don't need a paid developer account.

1. **Install Xcode** from the Mac App Store, open it once and let it install its extra components.
2. **Install XcodeGen.** With [Homebrew](https://brew.sh), run `brew install xcodegen`. You can
   also download it from the XcodeGen releases page on GitHub.
3. **Generate the project.** In Terminal, from the repository folder:
   ```sh
   cd ios
   xcodegen generate
   open FlockPoker.xcodeproj
   ```
   Run `xcodegen generate` again whenever you pull new changes.
4. **Sign in to Xcode** with your Apple ID: *Xcode > Settings > Accounts > +*.
5. **Pick your team for both targets.** In the project navigator, click **FlockPoker** (the blue
   icon). Then, for the **FlockPoker** target *and* the **FlockPokerMessages** target, open
   **Signing & Capabilities** and set **Team** to **"Your Name (Personal Team)"**.
   - If Xcode says the bundle identifier is not available, open `Config/Shared.xcconfig` and
     change `FLOCK_BUNDLE_PREFIX` to something unique, such as `com.yourname.flockpoker`. Then run
     `xcodegen generate` again and pick the team again.
   - Regenerating the project forgets the team you picked. To keep it, put your team ID in
     `DEVELOPMENT_TEAM =` in `Config/Shared.xcconfig`. After you pick the team once, you can find the
     ID under *Build Settings > Development Team*.
6. **Prepare the iPhone.** Plug it in, unlock it and tap **Trust** when it asks to trust this
   computer. Then turn on **Developer Mode** under *Settings > Privacy & Security > Developer Mode*.
   The iPhone restarts and asks you to confirm.
7. **Run it.** In Xcode's toolbar, choose the **FlockPoker** scheme and your iPhone, then press
   **Run** (▶). Xcode builds the app and installs it.
   - Because this is an iMessage-only app it has no home-screen icon. If Xcode asks which app to
     launch, choose **Messages**. If it says it couldn't launch the app, that's fine: it's installed.
   - To debug inside Messages, choose the **FlockPokerMessages** scheme instead. Xcode asks which
     app to run, so pick **Messages**.
8. **Trust your developer certificate** the first time. Go to *Settings > General > VPN & Device
   Management*, tap your Apple ID under *Developer App* and tap **Trust**.
9. **Play.** Open Messages and go to a conversation. Tap **+**, then **More**, then **Flock Poker**,
   and tap **New game**. Fill in the table settings, then tap **Send** on the bubble in the compose
   field. (If Flock Poker isn't listed, look under **More** and drag it up.)

### Limits of a free account

- **The app expires after 7 days.** A free (Personal Team) install stops opening after a week.
  Plug the phone in and press Run in Xcode again to renew it. Your games and seats are kept on the
  server.
- **Only your own devices.** A free account can't send the app to anyone else. Friends join from
  the plain link in the invite, which opens the table in Safari, and they play the same game. Their
  bubbles just open the App Store, because there is no App Store listing.
- **Want friends to get the app too?** Join the paid [Apple Developer Program](https://developer.apple.com/programs/)
  (99 USD a year). Then you can invite friends through **TestFlight** (up to 10,000 testers, with
  90-day builds) or publish to the App Store.

## Point it at another server

The extension loads the table from `FLOCK_SERVER_HOST` in `Config/Shared.xcconfig`, which is
`flock-poker.onrender.com` by default. To use your own deployment:

```
FLOCK_SERVER_HOST = poker.example.com
```

- Write only the host (and `:port` if it needs one), **never** `https://`. Two slashes start a
  comment in `.xcconfig` files. `Info.plist` adds the `https://` itself.
- The server must be reachable over **HTTPS**. The extension only shows pages from that exact host
  and ignores bridge messages from anywhere else. For a server on your own computer, use an HTTPS
  tunnel such as `cloudflared tunnel` or `ngrok`.
- Run `xcodegen generate` again (or just rebuild) after changing it. Bubbles keep the host they
  were sent with, so everyone in a conversation should use the same server.

## How it works

- **Compact view** (the app drawer) is native: the logo, **New game**, **Back to table** (when a
  table is open) and your recent tables.
- **Expanded view** shows the live web table in a `WKWebView`. It loads
  `https://<server>/?embed=imessage&create=1` for a new game, or
  `https://<server>/g/<ROOM>?embed=imessage` when you tap a bubble. The web view stays alive while
  Messages resizes the extension, so the table keeps its connection. Its website data persists, so
  reopening a bubble puts you back in your seat.
- **Bridge.** Before the page's scripts run, native defines `window.__FLOCK_NATIVE__` (your
  remembered name and the current size). The page sends events to
  `window.webkit.messageHandlers.flock`:
  - `bubble` posts a chat bubble,
  - `haptic` plays a vibration,
  - `presentation` asks Messages to resize,
  - `rememberName` stores your name,
  - `ready` says the page has loaded.

  Native answers with `flock:native` DOM events (`presentation`, `bubbleResult`). Messages are only
  accepted from the main frame of the configured server.
- **Bubbles.** Each table uses one `MSSession` per conversation, so a new bubble replaces the
  older one. Invites go into the compose field for you to send. Everything else is posted
  directly. If Messages refuses that because you haven't touched the app recently, the bubble goes
  into the compose field instead. Automatic bubbles are de-duplicated by key, so reloading the page
  never posts the same "Game started" twice. Your-turn and game-over keys can come back in a later
  game (hand numbers restart after a rematch), so those are only dropped when repeated within a
  minute (`BubbleDedupe` in FlockKit).

## Development

- `swift test --package-path ios/FlockKit` runs the FlockKit unit tests (macOS). They check every
  event in the shared fixture, the JSON native sends, script escaping (quotes, `</script>`, U+2028,
  emoji) run in JavaScriptCore, room-link parsing, the de-dup ledger and the recent-tables list.
- `node scripts/render-imessage-icons.mjs` re-renders the icons after `public/icon.svg` changes.
- In Debug builds the web view can be inspected from Safari on a Mac: *Develop > [your iPhone] >
  Flock Poker*.
- CI (`.github/workflows/ci.yml`, job `ios`) generates the project, runs the FlockKit tests, builds
  the app for the simulator without signing, and uploads the generated `FlockPoker.xcodeproj` as
  an artifact.
