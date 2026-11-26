import Foundation
import RecorderKit

/// Uses the same language and dictionary fallback as the board.
func recorderText(_ key: String, _ args: CVarArg...) -> String {
    let lang = BoardL10n.language()
    return String(format: BoardL10n.text(key, lang: lang),
                  locale: Locale(identifier: lang), arguments: args)
}
