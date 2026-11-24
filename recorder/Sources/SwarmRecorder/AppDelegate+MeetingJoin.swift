import AppKit

extension AppDelegate {
    /// Open in the system browser. Log no address, account or room identifier.
    @discardableResult
    func openJoinLink(_ url: URL?) -> Bool {
        guard let url else {
            Diagnostics.shared.log("JOIN browser entry unavailable")
            return false
        }
        let handler = NSWorkspace.shared.urlForApplication(toOpen: url)
        let bundleID = handler.flatMap { Bundle(url: $0)?.bundleIdentifier }
        let running = bundleID.map { NSRunningApplication.runningApplications(withBundleIdentifier: $0).count } ?? 0
        let opened = NSWorkspace.shared.open(url)
        Diagnostics.shared.log("JOIN host=\(url.host ?? "?") open=\(opened ? "ok" : "ОТКАЗ") "
            + "обработчик=\(bundleID ?? "нет") экземпляров=\(running)")
        return opened
    }
}
