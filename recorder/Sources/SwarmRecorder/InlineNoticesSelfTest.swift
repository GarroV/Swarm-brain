import AppKit
import RecorderKit

/// A separate UI preview: no audio, token, note files, outbox or network requests.
func runInlineNoticesSelfTest(seconds: Double) {
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    Task { @MainActor in
        let widget = RecorderWidget()
        var notes: LiveNotesPanel!
        func check(_ label: String) {
            let visible = app.windows.filter { $0.isVisible }.count
            let standalone = RecorderNotices.shared.hasStandaloneWindowForTests
            print("INLINE \(label) visible=\(visible) standalone=\(standalone) embedded=\(RecorderNotices.shared.isEmbeddedForTests)")
            fflush(stdout)
            if visible != 1 || standalone { exit(1) }
        }
        notes = LiveNotesPanel.preview(onCollapse: {
            widget.showRecording(startedAt: Date())
            check("collapsed")
        })
        widget.onToggleNotes = {
            widget.hide()
            notes.expand()
            check("expanded")
        }
        notes.expand()
        RecorderNotices.shared.post(id: "start-pick", title: "Which meeting is this?",
            body: "Choose the meeting for this recording.", lifetime: nil,
            actions: [
                .init(title: "Other call (not from the calendar)", isPrimary: true, run: {
                    print("INLINE selected=other notes=\(notes.noteBufferCountForTests)")
                    check("selected")
                }),
                .init(title: "Continuation: Example meeting", run: {
                    notes.setChosenTitle("Example meeting")
                    print("INLINE selected=calendar notes=\(notes.noteBufferCountForTests)")
                    check("selected")
                })
            ], isVertical: true)
        check("initial")
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { app.terminate(nil) }
    }
    app.run()
}
