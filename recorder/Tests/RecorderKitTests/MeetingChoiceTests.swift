import XCTest
@testable import RecorderKit

// Выбор встречи в капсуле (D026, D027): ошибка здесь молчаливая — «Подключиться» открыла бы
// не тот созвон, а запись легла бы не к той встрече.
final class MeetingChoiceTests: XCTestCase {
    private struct Offer: Equatable { let key: String; let url: String? }

    private func offers(_ items: [Offer], dismissed: Set<String> = []) -> [String] {
        MeetingChoice.offers(items, key: \.key, hasLink: { $0.url != nil },
                             isDismissed: { dismissed.contains($0) }).map(\.key)
    }

    func testEventWithoutLinkIsNeverOffered() {
        XCTAssertEqual(offers([Offer(key: "slot", url: nil)]), [])
        XCTAssertEqual(offers([Offer(key: "slot", url: nil), Offer(key: "call", url: "https://meet.google.com/a")]),
                       ["call"])
    }

    func testOverlappingCallsAreAllOfferedInServerOrder() {
        let items = [Offer(key: "b", url: "https://ktalk.ru/b"), Offer(key: "a", url: "https://meet.google.com/a")]
        XCTAssertEqual(offers(items), ["b", "a"])
    }

    func testDismissedAndDuplicateKeysAreDropped() {
        let items = [Offer(key: "a", url: "https://x.test/1"), Offer(key: "b", url: "https://x.test/2"),
                     Offer(key: "a", url: "https://x.test/3")]
        XCTAssertEqual(offers(items), ["a", "b"])
        XCTAssertEqual(offers(items, dismissed: ["a"]), ["b"])
    }

    func testChoiceIsFoundByKeyNotByPosition() {
        let shown = [Offer(key: "a", url: "https://meet.google.com/a"), Offer(key: "b", url: "https://ktalk.ru/b")]
        // Список обновился между показом и кликом: «b» теперь первая.
        let now = [Offer(key: "b", url: "https://ktalk.ru/b"), Offer(key: "c", url: "https://zoom.us/j/1")]
        XCTAssertEqual(MeetingChoice.chosen(now, key: \.key, shown[1].key)?.url, "https://ktalk.ru/b")
        XCTAssertNil(MeetingChoice.chosen(now, key: \.key, shown[0].key))
    }

    func testSameOfferComparesKeysInOrder() {
        let a = [Offer(key: "a", url: "u"), Offer(key: "b", url: "u")]
        XCTAssertTrue(MeetingChoice.sameOffer(a, a, key: \.key))
        XCTAssertFalse(MeetingChoice.sameOffer(a, Array(a.reversed()), key: \.key))
        XCTAssertFalse(MeetingChoice.sameOffer(a, [a[0]], key: \.key))
    }
}
