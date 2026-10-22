import XCTest
@testable import RecorderKit

// Словарь строк доски. Главное: ключ без перевода на одном из языков — это дыра в экране,
// которую в живом прогоне заметишь только на втором языке.
final class BoardL10nTests: XCTestCase {
    func testEveryKeyExistsInEveryLanguage() {
        let all = Set(BoardL10n.dictionaries.values.flatMap { $0.keys })
        for (lang, dict) in BoardL10n.dictionaries {
            XCTAssertEqual(Set(dict.keys), all, "в словаре \(lang) не хватает: \(all.subtracting(dict.keys).sorted())")
            for (k, v) in dict { XCTAssertFalse(v.isEmpty, "\(lang).\(k) пустой") }
        }
    }

    func testFormatPlaceholdersMatchAcrossLanguages() {
        func placeholders(_ s: String) -> [String] {
            ["%d", "%@"].flatMap { p in s.components(separatedBy: p).dropFirst().map { _ in p } }.sorted()
        }
        let ru = BoardL10n.dictionaries["ru"]!, en = BoardL10n.dictionaries["en"]!
        for k in ru.keys { XCTAssertEqual(placeholders(ru[k]!), placeholders(en[k]!), k) }
    }

    func testLanguageChoice() {
        XCTAssertEqual(BoardL10n.language(preferred: ["ru-RS", "en"]), "ru")
        XCTAssertEqual(BoardL10n.language(preferred: ["ru"]), "ru")
        XCTAssertEqual(BoardL10n.language(preferred: ["en-US"]), "en")
        XCTAssertEqual(BoardL10n.language(preferred: ["sl-SI"]), "en", "языка нет в словарях — английский")
        XCTAssertEqual(BoardL10n.language(preferred: []), "en")
    }

    func testFallbackAndFormat() {
        XCTAssertEqual(BoardL10n.text("tasks.empty", lang: "sl"), "All clear for today")
        XCTAssertEqual(BoardL10n.text("no.such.key", lang: "ru"), "no.such.key")
        XCTAssertEqual(BoardL10n.format("tasks.more", lang: "ru", 4), "ещё 4 → открыть в Swarm")
        XCTAssertEqual(BoardL10n.format("card.heard", lang: "en", "по Словении"), "Heard: по Словении")
    }

    func testCountryNames() {
        XCTAssertEqual(BoardCountries.name("SI", lang: "ru"), "Словения")
        XCTAssertEqual(BoardCountries.name("si", lang: "en"), "Slovenia")
        XCTAssertEqual(BoardCountries.name("ZZ", lang: "en"), "ZZ")
    }
}
