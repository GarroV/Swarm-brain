import AppKit
import RecorderKit

// Дыхание значка в простое (IdlePulse). Вынесено из RecorderWidget.swift без изменений
// (лимит размера файла, scripts/check-source-size.py); состояние живёт в самом виджете.
extension RecorderWidget {
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
