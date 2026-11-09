import AppKit
import RecorderKit

// Дыхание значка в простое (IdlePulse) — вынесено из RecorderWidget.swift без изменений
// (лимит размера файла, scripts/check-source-size.py); состояние живёт в самом виджете.
// Плюс заметность напоминания о записи (CallReminder, решение владельца 09.11.2026):
// акцентная обводка и мягкий пульс янтарной полоски баннера — без звука.
extension RecorderWidget {
    private static let reminderPulseKey = "reminderPulse"

    func applyReminderStyle(_ on: Bool) {
        guard let card = panel?.contentView?.layer else { return }
        card.borderColor = RoyArt.amber.withAlphaComponent(on ? 0.95 : 0.30).cgColor
        card.borderWidth = on ? 2 : 1
        bannerAccent.wantsLayer = true
        guard let accent = bannerAccent.layer else { return }
        if !on {
            accent.removeAnimation(forKey: Self.reminderPulseKey)
            accent.opacity = 1
        } else if accent.animation(forKey: Self.reminderPulseKey) == nil {   // повторный показ не сбрасывает фазу
            let a = CABasicAnimation(keyPath: "opacity")
            a.fromValue = 1.0
            a.toValue = 0.3
            a.duration = 0.9
            a.autoreverses = true
            a.repeatCount = .infinity
            a.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            accent.add(a, forKey: Self.reminderPulseKey)
        }
    }

    // Дыхание: включается тишиной, гаснет первым же звуком (IdlePulse).
    func updateIdlePulse() {
        let quiet = lastLevel < IdlePulse.silenceLevel && lastSysLevel < IdlePulse.silenceLevel
        silentTicks = quiet ? silentTicks + 1 : 0
        if IdlePulse.shouldPulse(micLevel: lastLevel, systemLevel: lastSysLevel, silentTicks: silentTicks) {
            startIdlePulse()
        } else {
            stopIdlePulse()
        }
    }

    // Неторопливое дыхание значка: opacity 1 → 0.45 и обратно, полный цикл 3.2 с. Тот же
    // приём, что у индикатора микрофона рядом (startPulse), только медленнее и мягче.
    // Покадровая перекраска марки, с которой я начал, читалась как бегущая дорожка и,
    // хуже того, трогала саму картинку — владелец 03.09.2026: «дело не в цвете, а в форме»,
    // «давай сделаем пульсацию, а не бегающую дорожку. и пульсацию неторопливую».
    func startIdlePulse() {
        guard !idlePulsing else { return }
        idlePulsing = true
        recMark.wantsLayer = true
        let a = CABasicAnimation(keyPath: "opacity")
        a.fromValue = 1.0
        a.toValue = IdlePulse.minOpacity
        a.duration = IdlePulse.halfPeriod
        a.autoreverses = true
        a.repeatCount = .infinity
        a.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)   // дыхание, не мигание
        recMark.layer?.add(a, forKey: "idlePulse")
    }

    func stopIdlePulse() {
        guard idlePulsing else { return }
        idlePulsing = false
        recMark.layer?.removeAnimation(forKey: "idlePulse")
        recMark.layer?.opacity = 1
    }
}
