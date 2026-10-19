import Foundation
import PDFKit
import AppKit

guard CommandLine.arguments.count >= 3 else {
    fputs("Usage: pdf2images <input.pdf> <output_dir>\n", stderr)
    exit(1)
}

let inputPath = CommandLine.arguments[1]
let outputDir = CommandLine.arguments[2]

guard let document = PDFDocument(url: URL(fileURLWithPath: inputPath)) else {
    fputs("Failed to open PDF\n", stderr)
    exit(2)
}

let pageCount = document.pageCount
let fm = FileManager.default
try? fm.createDirectory(atPath: outputDir, withIntermediateDirectories: true)

var generated: [String] = []

for i in 0..<pageCount {
    guard let page = document.page(at: i) else { continue }
    let pageRect = page.bounds(for: .mediaBox)
    // Scale so either width >= 1920 or height >= 1080 for crisp TV display
    let scale: CGFloat = max(1920.0 / max(pageRect.width, 1.0), 1080.0 / max(pageRect.height, 1.0), 2.0)
    let targetSize = NSSize(width: pageRect.width * scale, height: pageRect.height * scale)
    
    let image = NSImage(size: targetSize)
    image.lockFocus()
    
    guard let context = NSGraphicsContext.current?.cgContext else {
        image.unlockFocus()
        continue
    }
    
    context.setFillColor(NSColor.white.cgColor)
    context.fill(CGRect(origin: .zero, size: targetSize))
    
    context.saveGState()
    context.scaleBy(x: scale, y: scale)
    page.draw(with: .mediaBox, to: context)
    context.restoreGState()
    
    image.unlockFocus()
    
    guard let tiffData = image.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiffData),
          let pngData = rep.representation(using: .png, properties: [:]) else {
        continue
    }
    
    let outFile = "\(outputDir)/page_\(String(format: "%03d", i + 1)).png"
    try? pngData.write(to: URL(fileURLWithPath: outFile))
    generated.append(outFile)
}

print(generated.joined(separator: "\n"))
