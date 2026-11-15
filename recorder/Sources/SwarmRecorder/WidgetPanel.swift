import AppKit

// Панель капсулы. Отличает перетаскивание мышкой от любого другого сдвига окна: помнить
// место надо только после первого (решение владельца 12.11.2026). Окно двигает AppKit
// внутри `sendEvent(mouseDown)` (isMovableByWindowBackground) — после возврата из него
// сравниваем положение с тем, что было на mouseDown. Системные сдвиги (смена мониторов),
// показ и переход капсула ↔ баннер через мышь не идут и сюда не попадают.
final class WidgetPanel: NSPanel {
    var onDragEnd: (() -> Void)?
    private var originAtMouseDown: CGPoint?

    override func sendEvent(_ event: NSEvent) {
        if event.type == .leftMouseDown { originAtMouseDown = frame.origin }
        super.sendEvent(event)
        switch event.type {
        case .leftMouseUp:
            finishDragIfMoved()
        case .leftMouseDown where NSEvent.pressedMouseButtons & 1 == 0:
            finishDragIfMoved()   // цикл перетаскивания уже отработал внутри super и мышь отпущена
        default:
            break
        }
    }

    private func finishDragIfMoved() {
        guard let start = originAtMouseDown else { return }
        originAtMouseDown = nil
        if frame.origin != start { onDragEnd?() }
    }
}
