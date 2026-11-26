import RecorderKit

extension RecorderWidget {
    /// Use the existing recording surface for decisions, rather than a second window.
    func showBotPrompt(inNotes: Bool) {
        guard inNotes else { showBotPrompt(); return }
        hide()
        RecorderNotices.shared.postBotPrompt(
            keep: { [weak self] in self?.onBotKeep?() },
            stop: { [weak self] in self?.onBotStop?() })
    }
}
