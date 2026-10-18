// Numerical WebKit validation. No window is displayed and no images are viewed.
import AppKit
import WebKit

final class Verification: NSObject, WKNavigationDelegate {
    let webview: WKWebView = {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        if CommandLine.arguments.count == 3,
           let probe = try? String(contentsOfFile: CommandLine.arguments[2], encoding: .utf8) {
            configuration.userContentController.addUserScript(WKUserScript(source: probe, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        return WKWebView(frame: NSRect(x: 0, y: 0, width: 1024, height: 768), configuration: configuration)
    }()
    var timer: Timer?
    var attempts = 0
    func run(_ url: URL) {
        webview.navigationDelegate = self
        webview.load(URLRequest(url: url))
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [self] _ in
            attempts += 1
            if attempts > 160 { finish("{\"error\":\"WebKit verification timed out\"}", 1); return }
            webview.evaluateJavaScript("window.sourceSurfaceTrial?.ready ? JSON.stringify(window.sourceSurfaceTrial) : null") { [self] result, _ in
                if let text = result as? String { finish(text, text.contains("\"error\"") ? 1 : 0) }
            }
        }
    }
    func finish(_ text: String, _ code: Int32) {
        timer?.invalidate()
        print(text)
        fflush(stdout)
        exit(code)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        finish("{\"error\":\"WebKit navigation failed\"}", 1)
    }
}
guard (2...3).contains(CommandLine.arguments.count), let url = URL(string: CommandLine.arguments[1]), url.host == "127.0.0.1" else { exit(2) }
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let verification = Verification()
verification.run(url)
app.run()
