// OCR a PDF with macOS Vision: render each page at 3x with PDFKit, recognize text,
// then group the recognized blocks into lines (top-to-bottom, left-to-right). Blocks that are
// far apart on the same line are joined with two spaces, like src/pdf/text.js.
//
// Build: swiftc -O tools/ocr-pdf.swift -o /tmp/ocr-pdf   (macOS only; everything runs locally)
// Usage: /tmp/ocr-pdf <out-dir> <file.pdf> [<file.pdf> ...]   → writes <out-dir>/<file.pdf>.txt
// Pages are separated by "\n\f\n" (same as pdfLines().text).
// OCR_DEBUG=1 prints every block with its pixel coordinates.
//
// Vision quirk seen on this machine: with recognitionLanguages = ["en-US"] and no language
// correction, the accurate model sometimes ends a line with junk letters ("08/01/202ął",
// "-31.2ął") and can even swallow the last digit. Re-recognizing just that observation's
// tight crop fixes it, so suspicious observations get a second pass.
import Foundation
import PDFKit
import Vision
import CoreGraphics

struct Block {
  var x0: CGFloat, x1: CGFloat, y0: CGFloat, y1: CGFloat   // pixels, origin bottom-left
  var text: String
  var h: CGFloat { y1 - y0 }
}

let debug = ProcessInfo.processInfo.environment["OCR_DEBUG"] != nil

func render(_ page: PDFPage, scale: CGFloat) -> CGImage? {
  let box = page.bounds(for: .mediaBox)
  let rot = ((page.rotation % 360) + 360) % 360
  let (w, h) = (rot == 90 || rot == 270) ? (box.height, box.width) : (box.width, box.height)
  let pw = Int((w * scale).rounded()), ph = Int((h * scale).rounded())
  guard let ctx = CGContext(data: nil, width: pw, height: ph, bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
  ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
  ctx.fill(CGRect(x: 0, y: 0, width: pw, height: ph))
  ctx.interpolationQuality = .high
  ctx.scaleBy(x: scale, y: scale)
  page.draw(with: .mediaBox, to: ctx)   // PDFKit applies the page rotation
  return ctx.makeImage()
}

func recognize(_ img: CGImage) -> [VNRecognizedTextObservation] {
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.recognitionLanguages = ["en-US"]
  req.usesLanguageCorrection = false
  do { try VNImageRequestHandler(cgImage: img, options: [:]).perform([req]) }
  catch { FileHandle.standardError.write("vision error: \(error)\n".data(using: .utf8)!); return [] }
  return req.results ?? []
}

/// Characters that never belong in an English utility bill but show up as Vision junk:
/// Latin Extended-A/B (ą ę ł ś ź š ř ș …), Latin Extended Additional (Ạ Ị Ế …), Cyrillic, arrows/math.
func junkCount(_ s: String) -> Int {
  var n = 0
  for u in s.unicodeScalars {
    let v = u.value
    if (0x100...0x24F).contains(v) || (0x1E00...0x1EFF).contains(v) || (0x400...0x4FF).contains(v) || (0x2190...0x22FF).contains(v) { n += 1 }
  }
  return n
}

/// Split one observation into blocks at large gaps between words (Vision sometimes keeps
/// far-apart columns in one observation). `map` converts a normalized rect to page pixels.
func blocks(of obs: VNRecognizedTextObservation, map: (CGRect) -> CGRect) -> [Block] {
  guard let cand = obs.topCandidates(1).first else { return [] }
  let s = cand.string
  func blk(_ r: CGRect, _ t: String) -> Block { let p = map(r); return Block(x0: p.minX, x1: p.maxX, y0: p.minY, y1: p.maxY, text: t) }
  var words: [(String, CGRect?)] = []
  var i = s.startIndex
  while i < s.endIndex {
    while i < s.endIndex && s[i] == " " { i = s.index(after: i) }
    if i >= s.endIndex { break }
    var j = i
    while j < s.endIndex && s[j] != " " { j = s.index(after: j) }
    let b = (try? cand.boundingBox(for: i..<j))??.boundingBox
    words.append((String(s[i..<j]), b))
    i = j
  }
  let whole = blk(obs.boundingBox, s.trimmingCharacters(in: .whitespaces))
  if words.isEmpty || words.contains(where: { $0.1 == nil }) { return whole.text.isEmpty ? [] : [whole] }
  let lineH = whole.h
  var out: [Block] = []
  var cur: Block? = nil
  for (w, r) in words {
    let b = blk(r!, w)
    if var c = cur {
      if (b.x0 - c.x1) > lineH * 1.2 { out.append(c); cur = b }
      else { c.x1 = max(c.x1, b.x1); c.y0 = min(c.y0, b.y0); c.y1 = max(c.y1, b.y1); c.text += " " + w; cur = c }
    } else { cur = b }
  }
  if let c = cur { out.append(c) }
  return out
}

/// Render just a rectangle of the page (rect in page pixels at `baseScale`, origin bottom-left)
/// at a higher scale. Returns the image plus a map from its normalized coords to page pixels.
func renderRegion(_ page: PDFPage, rect: CGRect, baseScale: CGFloat, scale: CGFloat) -> (CGImage, (CGRect) -> CGRect)? {
  guard page.rotation % 360 == 0 else { return nil }
  let k = scale / baseScale
  let pw = Int((rect.width * k).rounded()), ph = Int((rect.height * k).rounded())
  guard pw > 0, ph > 0, let ctx = CGContext(data: nil, width: pw, height: ph, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
  ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
  ctx.fill(CGRect(x: 0, y: 0, width: pw, height: ph))
  ctx.interpolationQuality = .high
  ctx.scaleBy(x: scale, y: scale)
  ctx.translateBy(x: -rect.minX / baseScale, y: -rect.minY / baseScale)
  page.draw(with: .mediaBox, to: ctx)
  guard let img = ctx.makeImage() else { return nil }
  let map = { (r: CGRect) -> CGRect in
    CGRect(x: rect.minX + r.minX * rect.width, y: rect.minY + r.minY * rect.height, width: r.width * rect.width, height: r.height * rect.height) }
  return (img, map)
}

func ocrPage(_ page: PDFPage, scale: CGFloat) -> [String] {
  guard let img = render(page, scale: scale) else { return [] }
  let W = CGFloat(img.width), H = CGFloat(img.height)
  let pageMap = { (r: CGRect) -> CGRect in CGRect(x: r.minX * W, y: r.minY * H, width: r.width * W, height: r.height * H) }
  var all: [Block] = []
  for obs in recognize(img) {
    let text = obs.topCandidates(1).first?.string ?? ""
    var junk = junkCount(text)
    var replacement: [Block]? = nil
    if junk > 0 {
      // Second pass on a tight region around this observation: first a crop of the same
      // image, then the region re-rendered from the PDF at higher resolutions.
      let bb = pageMap(obs.boundingBox)
      let pad = bb.height * 0.3
      let region = CGRect(x: bb.minX - pad, y: bb.minY - pad, width: bb.width + 2 * pad, height: bb.height + 2 * pad)
        .integral.intersection(CGRect(x: 0, y: 0, width: W, height: H))
      var tries: [(CGImage, (CGRect) -> CGRect)] = []
      let cropRect = CGRect(x: region.minX, y: H - region.maxY, width: region.width, height: region.height)
      if let cimg = img.cropping(to: cropRect) {
        tries.append((cimg, { r in CGRect(x: region.minX + r.minX * region.width, y: region.minY + r.minY * region.height,
                                          width: r.width * region.width, height: r.height * region.height) }))
      }
      for sc in [scale * 4 / 3, scale * 5 / 3, scale * 2] {
        if let t = renderRegion(page, rect: region, baseScale: scale, scale: sc) { tries.append(t) }
      }
      for (timg, tmap) in tries {
        let again = recognize(timg)
        let againText = again.map { $0.topCandidates(1).first?.string ?? "" }.joined(separator: " ")
        let j = junkCount(againText)
        if !again.isEmpty && j < junk {
          if debug { print("retry: [\(text)] -> [\(againText)]") }
          replacement = again.flatMap { blocks(of: $0, map: tmap) }
          junk = j
          if j == 0 { break }
        }
      }
    }
    all += replacement ?? blocks(of: obs, map: pageMap)
  }

  // Group into rows by the bottom edge (≈ baseline; text.js groups by baseline too). The
  // vertical middle is less reliable because amounts are often set in a larger/bolder font.
  all.sort { $0.y0 > $1.y0 }
  if debug { for b in all { print(String(format: "%7.1f %6.1f %7.1f %7.1f  ", b.y0, b.h, b.x0, b.x1) + b.text) } }
  var rows: [[Block]] = []
  var rowY: [CGFloat] = [], rowH: [CGFloat] = []
  func nearest(_ b: Block) -> Int {
    var best = -1, bestD = CGFloat.greatestFiniteMagnitude
    for k in rows.indices {
      let d = abs(rowY[k] - b.y0)
      if d < 0.4 * min(rowH[k], b.h) && d < bestD { best = k; bestD = d }
    }
    return best
  }
  for b in all {
    let k = nearest(b)
    if k < 0 { rows.append([b]); rowY.append(b.y0); rowH.append(b.h) } else { rows[k].append(b) }
  }
  // One refinement pass: move each block to the row whose median bottom is closest.
  for k in rows.indices {
    let ys = rows[k].map { $0.y0 }.sorted(); rowY[k] = ys[ys.count / 2]
    let hs = rows[k].map { $0.h }.sorted(); rowH[k] = hs[hs.count / 2]
  }
  let flat = rows.flatMap { $0 }
  var regrouped = Array(repeating: [Block](), count: rows.count)
  for b in flat {
    let k = nearest(b)
    if k >= 0 { regrouped[k].append(b) }
    else { rows.append([b]); rowY.append(b.y0); rowH.append(b.h); regrouped.append([b]) }
  }
  rows = regrouped

  var lines: [String] = []
  for k in rows.indices.filter({ !rows[$0].isEmpty }).sorted(by: { rowY[$0] > rowY[$1] }) {
    let r = rows[k].sorted { $0.x0 < $1.x0 }
    let h = r.map { $0.h }.max() ?? 10
    var line = "", end: CGFloat? = nil
    for b in r {
      if let e = end { line += (b.x0 - e) > h * 0.9 ? "  " : " " }
      line += b.text
      end = b.x1
    }
    let t = line.trimmingCharacters(in: .whitespaces)
    if !t.isEmpty { lines.append(t) }
  }
  return lines
}

let args = CommandLine.arguments
guard args.count >= 3 else { print("usage: ocr <out-dir> <file.pdf>..."); exit(2) }
let outDir = URL(fileURLWithPath: args[1])
for path in args[2...] {
  let url = URL(fileURLWithPath: path)
  guard let doc = PDFDocument(url: url) else { FileHandle.standardError.write("cannot open \(path)\n".data(using: .utf8)!); continue }
  var pages: [String] = []
  for p in 0..<doc.pageCount {
    autoreleasepool {
      guard let page = doc.page(at: p) else { pages.append(""); return }
      pages.append(ocrPage(page, scale: 3).joined(separator: "\n"))
    }
  }
  let out = outDir.appendingPathComponent(url.lastPathComponent + ".txt")
  do { try pages.joined(separator: "\n\u{0C}\n").write(to: out, atomically: true, encoding: .utf8) }
  catch { FileHandle.standardError.write("cannot write \(out.path): \(error)\n".data(using: .utf8)!); continue }
  print("ok \(url.lastPathComponent) \(doc.pageCount) pages")
}
