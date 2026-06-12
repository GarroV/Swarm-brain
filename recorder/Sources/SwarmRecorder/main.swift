import AppKit

// Меню-бар агент: без иконки в Dock, без главного окна.
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
