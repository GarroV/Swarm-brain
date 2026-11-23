import AppKit
import RecorderKit

/// Actual NSPanel and run-loop timer, without audio, calendar, upload or messages.
func runRecordingPromptSelfTest() {
    setvbuf(stdout, nil, _IOLBF, 0)
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let widget = RecorderWidget(promptLifetime: 1.2)
    let notice = MeetingNotice(title: "Идёт звонок", subtitle: "")
    func check(_ condition: Bool, _ label: String) {
        print("PROMPT \(condition ? "OK" : "FAIL") \(label)")
        if !condition { exit(1) }
    }
    func offer(_ key: String = "call") {
        widget.showPending(notice: notice, canJoin: false, promptKey: key)
    }
    offer()
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
        guard let panel = widget.panel, let screen = NSScreen.main else { exit(1) }
        check(panel.isVisible, "offer visible; production lifetime=\(RecordingPromptLifetime.defaultLifetime)s")
        let expected = WidgetPlacement.notificationOrigin(size: panel.frame.size, in: screen.visibleFrame)
        check(panel.frame.origin == expected, "top-right frame=\(panel.frame)")
        panel.setFrameOrigin(CGPoint(x: screen.visibleFrame.midX, y: screen.visibleFrame.midY))
        offer()
        check(panel.frame.origin == expected, "previous position ignored")
        if let path = ProcessInfo.processInfo.environment["SWARM_PROMPT_SELFTEST_IMAGE"],
           let view = panel.contentView, let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) {
            view.cacheDisplay(in: view.bounds, to: bitmap)
            try? bitmap.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
        }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { offer() }
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) {
        check(widget.panel?.isVisible == false, "timer hides refreshed offer")
        offer()
        check(widget.panel?.isVisible == false, "expired call stays hidden")
        offer("next-call")
        check(widget.panel?.isVisible == true, "new call can offer recording")
        widget.showRecording(startedAt: Date())
        check(widget.currentSize().width == 72, "recording replaces offer")
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.9) {
        check(widget.panel?.isVisible == true, "old offer timer cannot hide recording")
        widget.hide()
        check(widget.panel?.isVisible == false, "end clears panel")
        exit(0)
    }
    app.run()
}
