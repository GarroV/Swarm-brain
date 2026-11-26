import AppKit
import RecorderKit

/// Exercise real views and action handlers without showing a window or recording audio.
func runInlineNoticesChecks() {
    let app = NSApplication.shared
    app.setActivationPolicy(.prohibited)
    Task { @MainActor in
        var checks = 0
        func check(_ value: @autoclosure () -> Bool, _ label: String) {
            guard value() else { print("INLINE FAIL \(label)"); exit(1) }
            checks += 1
            print("INLINE OK \(label)")
        }
        func descendants(_ view: NSView) -> [NSView] {
            [view] + view.subviews.flatMap(descendants)
        }
        func press(_ id: String, in host: NSView) {
            guard let button = descendants(host).compactMap({ $0 as? NSButton }).first(where: {
                $0.accessibilityIdentifier() == id
            }) else { print("INLINE FAIL missing action \(id)"); exit(1) }
            button.performClick(nil)
        }
        let notices = RecorderNotices.shared
        var collapsed = 0
        var selected = ""
        let notes = LiveNotesPanel.preview(presentsWindow: false, onCollapse: { collapsed += 1 })
        notes.expand()
        let host = notes.noticeHostForTests
        @MainActor func postChoice() {
            notices.post(id: "start-pick", title: "Which meeting is this?", lifetime: nil,
                actions: [
                    .init(title: "Other call", isPrimary: true, run: { selected = "other" }),
                    .init(title: "Continuation: Example meeting", run: {
                        selected = "calendar"
                        notes.setChosenTitle("Example meeting")
                    })
                ], isVertical: true)
        }
        postChoice()
        check(notices.isEmbeddedForTests && !notices.hasStandaloneWindowForTests, "choice has no separate window")
        check(host.views.count == 1, "one inline choice")
        notes.addNoteForTests("Synthetic note")
        press("notice.action.start-pick.1", in: host)
        check(selected == "calendar", "calendar action reaches its handler")
        check(notes.currentTitleOverride() == "Example meeting", "chosen meeting title is applied")
        check(notes.noteBufferCountForTests == 1, "choice preserves the note buffer")
        check(host.views.isEmpty && host.isHidden, "answered choice is removed")
        postChoice()
        notes.windowDidResignKey(Notification(name: NSWindow.didResignKeyNotification))
        check(collapsed == 1 && !notes.isExpandedForTests, "losing focus collapses recording surface")
        notes.collapse()
        check(collapsed == 1, "collapse callback runs once")
        check(host.views.count == 1 && !notices.hasStandaloneWindowForTests, "collapsed choice does not become a popup")
        notes.expand()
        check(notes.isExpandedForTests && host.views.count == 1, "choice survives reopening")
        press("notice.action.start-pick.0", in: host)
        check(selected == "other" && notes.noteBufferCountForTests == 1, "other call preserves notes")
        postChoice()
        press("notice.close.start-pick", in: host)
        check(host.views.isEmpty, "dismiss removes the inline choice")
        var kept = 0
        notices.postBotPrompt(keep: { kept += 1 }, stop: { kept -= 1 })
        notices.postBotPrompt(keep: { kept += 10 }, stop: {})
        check(host.views.count == 1, "bot decision does not duplicate")
        press("notice.action.\(RecorderNotices.botPromptId).0", in: host)
        check(kept == 1 && host.views.isEmpty, "continue recording uses the original handler")
        notices.postBotPrompt(keep: {}, stop: { kept -= 1 })
        press("notice.action.\(RecorderNotices.botPromptId).1", in: host)
        check(kept == 0 && host.views.isEmpty, "stop recording uses its handler")
        postChoice()
        notices.dismiss(id: "start-pick")
        notes.hide()
        check(!notices.isEmbeddedForTests && !notices.hasStandaloneWindowForTests, "ending recording leaves no stale popup")
        check(app.windows.allSatisfy { !$0.isVisible }, "checks never show a window")
        print("INLINE PASS \(checks) checks")
        exit(0)
    }
    app.run()
}
