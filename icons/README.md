# House Ledger 图标

## 当前版本 v3

2026-11-15，采用已确认的统一设计：青绿渐变背景、奶白色实心房屋、镂空闪电。

资源从 `/Users/chizhang/Documents/Repositories/babble/icon-update-kit/assets/house-ledger/icons/` 原样复制，未重新生成、缩放或修改图案，也未运行 `install.py`。

- `icon.svg`：512 × 512 viewBox，SVG favicon。
- `icon-180-v3.png`：180 × 180，Apple Touch Icon、PNG favicon 备用及 App 侧栏。
- `icon-512-v3.png`：512 × 512，安装图标；两个 manifest 都引用 v3 PNG。
- 上述三个文件均加入 `sw.js` 预缓存，缓存版本为 `house-ledger-v16`。
- 原版 PNG、v2 PNG 与 v2 母版均保留。下方保留 v2 的来源和提示词，仅作为历史记录。

原始资源 SHA-256（用于核对复制一致性）：

```text
cd2f34829744a6923b4ed13714ff4e5ff7a8127bd1ae669832c761064088574e  icon.svg
563a24f63cbe24fea072cb41022ddb11fa1a659b7fedac495dd67445786040d6  icon-180-v3.png
e26ce3b2df9b9db957a440a6c78366863f3bad99d883bc3362754ec352908591  icon-512-v3.png
```

## 历史版本 v2

2026-11-11，使用内置 imagegen 根据现有房子与闪电图标，以及本次对话提供的青绿色 App 图标参考图，进行风格转换。

- `icon-v2-master.png`：生成母版，原始文件字节保留。
- `icon-512-v2.png`：512 × 512，安装图标。
- `icon-180-v2.png`：180 × 180，Apple Touch Icon、网站图标与 App 侧栏。
- 两个发布尺寸仅由母版等比缩小，不另外描绘或调整颜色。图片为不透明方形底，展示时使用对应入口的圆角。
- 原版 `icon-512.png` 与 `icon-180.png` 保留，便于比对。

### 生成提示词

```text
Use case: style-transfer
Asset type: production House Ledger app icon, a single square PNG asset.
Input images: Image 1 is the current House Ledger icon to redesign; preserve its identity as ONE house with ONE centered lightning bolt. Image 2 is the primary style reference (teal rounded-square tile with a white document pictogram). Image 3 is a supporting style reference, a pair of matching app icons; use the TEAL icon's style and color, not the terracotta color and not the book/document symbols.
Primary request: restyle the house-and-lightning icon to belong to the same icon family as Images 2 and 3. Keep the single centered house with a pitched roof and the lightning bolt clearly inside it. Match the references' calm teal gradient, pure warm-white pictogram, generous spacing, smooth rounded line joins and strong legibility.
Style/medium: exceptionally clean flat vector-like app icon. Use a white OUTLINE house with softly rounded corners and rounded joins, and a separate bold solid white lightning bolt inside. The house outline is about 4.5 to 5 percent of the canvas width. Preserve clear teal negative space between the bolt and the house outline. No door, window, chimney, document lines or other added symbols.
Composition/framing: one centered balanced house-and-bolt pictogram; approximately 58 to 62 percent canvas width, with comfortable and balanced padding. Keep the lightning bolt visually centered inside the house, slightly softened at its sharpest corners, clear at 32 pixels. The pictogram must be front-facing and symmetrical except the lightning shape.
Color palette: a smooth subtle vertical teal gradient, approximately #32A59B at the top to #207B72 at the bottom; solid near-white pictogram, like the reference icons. No yellow or orange accent. No grain or texture.
Production canvas: full-bleed opaque square teal background reaching every edge, with NO outer margin or surrounding beige/pink page. Do not bake rounded tile corners into this square asset: the app and operating system supply the rounded mask. The desired look when masked is the rounded-square teal icon in the references. Do not include a presentation board, device, icon mockup, shadow outside the canvas, or a second icon.
Constraints: preserve the house and central bolt as the sole subject; change the visual treatment only. No letters, words, numbers, logos, captions or watermark. No photorealistic materials, bevels, glass, metallic lighting, 3D extrusion, drop shadows on the white glyph, decorative outlines, or new pictograms. Deliver exactly one centered icon.
```

