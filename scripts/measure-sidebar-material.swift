// Measurement tool, not part of the app. Build and run: swiftc -O scripts/measure-sidebar-material.swift -o /tmp/m && /tmp/m light black /tmp/x.png (the terminal needs Screen Recording permission).
// Measures the macOS sidebar material (NSVisualEffectView .sidebar, active, behind-window blending,
// as Tauri's Effect::Sidebar sets it) over a full-screen black or white backdrop window of this
// process, in light or dark appearance. Captures the panel with screencapture and prints the mean
// sRGB color of its middle. Usage: swift measure.swift <light|dark> <black|white> <out.png>
import AppKit

let args = CommandLine.arguments
let appearanceName = args[1] == "dark" ? NSAppearance.Name.darkAqua : NSAppearance.Name.aqua
let backdropColor = args[2] == "white" ? NSColor.white : NSColor.black
let out = args[3]

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let screen = NSScreen.main!

let backdrop = NSWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
backdrop.backgroundColor = backdropColor
backdrop.level = .normal
backdrop.isOpaque = true
backdrop.orderFrontRegardless()

let size = NSSize(width: 360, height: 360)
let origin = NSPoint(x: screen.frame.midX - size.width / 2, y: screen.frame.midY - size.height / 2)
let panel = NSWindow(contentRect: NSRect(origin: origin, size: size), styleMask: .borderless, backing: .buffered, defer: false)
panel.appearance = NSAppearance(named: appearanceName)
panel.isOpaque = false
panel.backgroundColor = .clear
panel.level = .floating
let effect = NSVisualEffectView(frame: NSRect(origin: .zero, size: size))
effect.material = .sidebar
effect.state = .active
effect.blendingMode = .behindWindow
panel.contentView = effect
panel.orderFrontRegardless()
app.activate(ignoringOtherApps: true)

DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
    // screencapture -R takes points with the origin at the top left of the main screen.
    let top = screen.frame.height - (origin.y + size.height)
    let inset: CGFloat = 60
    let rect = "\(Int(origin.x + inset)),\(Int(top + inset)),\(Int(size.width - 2 * inset)),\(Int(size.height - 2 * inset))"
    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
    task.arguments = ["-x", "-R", rect, out]
    try? task.run()
    task.waitUntilExit()
    guard let source = NSImage(contentsOfFile: out),
          let cg = source.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        print("capture failed (Screen Recording permission?)")
        exit(2)
    }
    let w = cg.width, h = cg.height
    var pixels = [UInt8](repeating: 0, count: w * h * 4)
    let ctx = CGContext(data: &pixels, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                        space: CGColorSpace(name: CGColorSpace.sRGB)!,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
    var sum = [0.0, 0.0, 0.0], minL = 255.0, maxL = 0.0
    for i in stride(from: 0, to: pixels.count, by: 4) {
        let r = Double(pixels[i]), g = Double(pixels[i + 1]), b = Double(pixels[i + 2])
        sum[0] += r; sum[1] += g; sum[2] += b
        let l = (r + g + b) / 3
        minL = min(minL, l); maxL = max(maxL, l)
    }
    let n = Double(w * h)
    print(String(format: "%@ %@ mean sRGB %.1f %.1f %.1f  (pixel gray range %.0f to %.0f, %dx%d px)",
                 args[1], args[2], sum[0] / n, sum[1] / n, sum[2] / n, minL, maxL, w, h))
    exit(0)
}
app.run()
