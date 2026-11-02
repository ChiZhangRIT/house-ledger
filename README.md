# 合租账本（House Ledger）

记录合租房子的水电网账单和房租：把账单 PDF 交给它，自动读出日期、服务周期、金额、分项和用量，按每个人住的天数分摊，和房租一起向室友收款，并按月、按季节、按单价对比各个月的情况。

- 纯网页 app（ES module，不需要编译、不需要服务器），可以放在 GitHub Pages 上
- 数据保存在你自己设备的浏览器里；开启多设备同步后，会另存一份到你自己的 GitHub 私有仓库，不经过任何第三方服务器
- Mac、iPhone、iPad 都能用，iPhone / iPad 可以添加到主屏幕当 app 用，没网也能打开（第一次读 PDF 需要联网下载读取组件，之后离线也能读）
- 界面有简体中文和 English（设置里切换）；深色模式跟随系统，也可以固定

## 添加账单

点「＋ 添加账单」选 PDF（可以一次选好几份），或者在 Mac 上直接把 PDF 拖进窗口：

1. PDF 只在这台设备上读取，**不上传、不保存**，只记文件名和指纹（SHA-256，用来发现重复导入）
2. 认出是哪家的账单（现在认识 PG&E、City of Sunnyvale、AT&T Fiber、Xfinity），读出账单日期、服务期、到期日、本期新费用（不含上期余额）、分项和用量
3. 确认页会检查：分项加起来是否等于总额、服务天数是否正常、和上一张是否接得上、是不是重复的账单、比去年同一段日期贵了多少；同时预览每人分多少
4. 保存后自动分摊，首页、收款、对比都会跟着更新

读不出文字的扫描件可以「粘贴账单文字」（从「预览」里全选复制，或者用 iPhone 照片的「实况文本」），也可以手动录入。

## 分摊规则

- 一张账单按「人·天」分给参与的住户：服务期里住着的每一天 × 当天的权重（比如情侣按 2 人算）
- 入住当天算，搬出当天不算；零头按最大余数法分配，各人加起来正好等于账单金额
- 每位住户可以按类别（电和燃气 / 水与垃圾 / 网）设成：**分摊**、**不参与**（不计人·天，他那份由其他人分）、**我承担**（照常计人·天，他那份记在主租客名下，适合房租已含水电网的人）
- PG&E、AT&T、Xfinity 账单上印的结束日算在本期内（下一张从第二天开始），City of Sunnyvale 的和下一张共用；在「设置 → 账单方」里可以改
- 从原来表格导入的历史账单，每人的金额按表格**锁定**，不会因为以后改住户设置而变化

## 收款

- 每月 16 日（可以改）开始一个收款期；房租按住户的月租现算，入住、搬出那一期按天折算
- 水电网份额默认跟下一次交房租一起收（确认账单时可以改到别的期）
- 记收款时先抵最早到期的应收；多付的算预付，自动抵以后的费用；退款记负数
- 「开账期」之前的房租和账单不计入收款（原来表格里的历史只用来统计和对比）
- 「导出明细」生成发给室友的文字明细（中文或英文），可以复制到微信 / iMessage，或者打印存成 PDF；明细里只写这个人自己的天数和比例，不写其他住户的名字

## 第一次使用：导入原来的 Numbers 表格

原来的表格要先在电脑上转换成导入文件，转换出来的文件含有姓名和金额，**请放在仓库外面**：

```sh
# 1. 把 Numbers 表格导出成 JSON（用法和注意事项见 tools/dump-numbers.py 开头）
/tmp/np/bin/python tools/dump-numbers.py "…/Shared Utilities.numbers" /tmp/dump.json
# 2.（可选）把账单 PDF 解析一遍，补上用量、分项和到期日；旧的扫描版 PG&E 账单先在本机 OCR
swiftc -O tools/ocr-pdf.swift -o /tmp/ocr-pdf
/tmp/ocr-pdf /tmp/ocr-out "…/PG&E Statements/"*.pdf
node tools/extract-pdfs.mjs "…/Utilities" /tmp/extract /tmp/ocr-out
# 3. 生成导入文件（私人设置写房子名称、不分摊水电网的人等，格式见脚本开头）
node tools/migrate-numbers.mjs /tmp/dump.json "…/house-ledger-import.json" /tmp/extract "…/house-ledger-migrate.private.json"
```

然后在 app 里「设置 → 数据 → 导入文件…」选这个文件。导入是逐条合并的：较新的为准，在 app 里改过的内容不会被旧文件覆盖，重复导入也不会重复。

## 多设备同步

和虚拟书架的做法一样，用你自己的 GitHub 私有仓库保存一个 `house-ledger.json`：

1. 在 GitHub 新建一个仓库（比如 `house-ledger-data`），选 **Private**
2. 新建 Fine-grained 令牌：Repository access 只选这个仓库，Permissions 里 **Contents** 设为 **Read and write**
3. 在 app 的「设置 → 设置同步」里填「用户名/仓库名」和令牌
4. 其他设备上点「复制同步码」→ 在新设备上粘贴

公开的仓库会被拒绝（账本里有姓名和金额）。令牌只存在本机，不会进备份，也不会同步。每条记录按修改时间合并，几台设备同时改也不会丢。

## 隐私

- 仓库里没有任何真实数据：`.gitignore` 排除了 PDF、Numbers、CSV、导入 / 备份文件和 `*.private.json`；测试只用编造的数据
- 网页只会连 `api.github.com`（开了同步时），没有统计、字体或 CDN 请求；`index.html` 里有 Content-Security-Policy 限制
- iPhone / iPad 上建议从主屏幕打开：Safari 网页的数据长时间不打开可能会被系统清掉，主屏幕上的不会

## 开发

```sh
node --test tests/*.test.mjs tests/parsers/*.test.mjs
```

- `src/core/`：分摊、统计、收款账、检查、提醒、数据合并、同步（不依赖网页，都有测试）
- `src/pdf/`：取 PDF 文字和各家账单的解析器（网页和 `tools/` 共用）
- `src/views/`、`src/ui/`：页面和图表（自己画的 SVG，配色经过色盲检查）
- `vendor/pdfjs/`：pdf.js 6.5.438（Apache-2.0，见其中的 LICENSE）
- 加了新的 `src/` 文件要写进 `sw.js` 的 `CORE`（有测试检查）

本地预览需要一个静态文件服务器（ES module 不能直接从 `file://` 打开），比如 `python3 -m http.server`，然后打开 `http://localhost:8000`。
