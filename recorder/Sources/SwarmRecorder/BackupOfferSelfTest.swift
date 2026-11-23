import AppKit

/// Server signals → actual AppDelegate state/key → actual expiring recording offer. No audio or network.
func runBackupOfferSelfTest() {
    setvbuf(stdout, nil, _IOLBF, 0)
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = AppDelegate()
    let widget = RecorderWidget(promptLifetime: 0.5)
    widget.onDismiss = { widget.hide() }
    let healthy = SwarmClient.MeetingLookup(meetings: [], tokenDead: false, recordedNow: ["call"])
    let failed = SwarmClient.MeetingLookup(meetings: [], tokenDead: false, recordedNow: ["call"], backupAvailable: ["call"])
    func check(_ condition: Bool, _ label: String) {
        print("BACKUP \(condition ? "OK" : "FAIL") \(label)")
        if !condition { exit(1) }
    }
    delegate.noteBotSignals(healthy)
    check(healthy.coveredNow == ["call"], "healthy bot covers recording")
    widget.showPending(notice: .init(title: "Идёт звонок", subtitle: ""), canJoin: false,
                       promptKey: delegate.recordingPromptKey(for: "call"))
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
        check(widget.panel?.isVisible == false, "earlier offer has expired")
        delegate.noteBotSignals(failed)
        check(failed.coveredNow.isEmpty, "capture failure unmutes recording offer")
        check(delegate.botNow.contains("call"), "bot presence is retained")
        let key = delegate.recordingPromptKey(for: "call")
        check(key == "call:backup", "backup has a distinct offer lifetime")
        widget.showPending(notice: .init(title: "Идёт звонок", subtitle: ""), canJoin: false, promptKey: key)
        check(widget.panel?.isVisible == true, "backup appears after expired initial offer")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
            check(widget.panel?.isVisible == false, "backup offer expires")
            let firstLogs = Diagnostics.shared.takePending().joined(separator: "\n")
            for event in ["available", "offered", "offer_expired"] {
                check(firstLogs.contains("\"event\":\"\(event)\""), "journal records \(event)")
            }
            delegate.noteBotSignals(healthy)
            check(healthy.coveredNow == ["call"], "sound recovery restores coverage")
            widget.hide()
            delegate.noteBotSignals(failed)
            widget.showPending(notice: .init(title: "Идёт звонок", subtitle: ""), canJoin: false, promptKey: key)
            check(app.sendAction(NSSelectorFromString("dismissAction"), to: widget, from: nil), "close action is connected")
            check(widget.panel?.isVisible == false, "close action hides backup offer")
            let nextLogs = Diagnostics.shared.takePending().joined(separator: "\n")
            for event in ["cleared", "dismissed", "offer_removed"] {
                check(nextLogs.contains("\"event\":\"\(event)\""), "journal records \(event)")
            }
            exit(0)
        }
    }
    app.run()
}
