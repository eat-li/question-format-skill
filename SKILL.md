---
name: question-format
description: 把 Word、聊天记录、截图 OCR 里粘来的数学题目整理成结构规范、公式可渲染的 HTML。用于「整理/排版/规范化题目格式」「把公式改成能渲染的写法」「批量把题目转成 HTML」，典型输入是 Unicode 数学符号（² √ ≥ α）、选项挤一行、公式没有定界符。内置确定性防泄题与数字/选项守恒校验；不做 OCR、不出新题、不判分、不改题意。
---

# 题目排版 Skill

## 这个 skill 解决什么

输入通常是脏的：`已知f(x)=x²-2x+3，求f(2)的值。A.1 B.3 C.5 D.7`。
期望输出是能直接渲染的 HTML：`<p>已知 $f(x)=x^{2}-2x+3$，求 $f(2)$ 的值。</p><p>A. 1</p>…`。

难点不在「把文字放进 `<p>`」，而在两个地方：

1. **公式必须变成 KaTeX 能吃的 LaTeX**，且不得改变原题的任何一个数字与条件。
2. **不得新增内容**——尤其是不得补出答案与解析。题干会直接展示给学生，多写一段「答案：4」就是泄题事故。

第 2 点是本 skill 与「随手写一句提示词」的核心差别：它由代码兜底，不靠模型自觉。
现在还有一道 `guard`：除了防泄题，它还会离线检查数字/选项是否守恒、有没有裸 `$` 或危险标签。

## 先选路径再动手

| 情况 | 走哪条 | 怎么做 |
| --- | --- | --- |
| 用户给了题目文本，要整理格式（1 道或几道） | **A. 你直接排版** | 按下面的「排版规则」自己产出 HTML，**交付前跑 `guard`**；不需要 API Key |
| 用户已有 HTML，只想修公式（Unicode 符号残留、`\(...\)` 混用） | **B. 本地修复** | `node bin/qformat.mjs repair <文件>` |
| 用户有几十上百道题要批量处理 | **C. CLI 批处理** | `node bin/qformat.mjs format <items.json> --batch`（需要 API Key，可加 `--concurrency`） |
| 已有 HTML，想确认公式能不能渲染 | **校验** | `node bin/qformat.mjs verify <文件>`（需 `npm i`） |
| 已有 HTML，想确认没泄题、没改数字 | **守卫** | `node bin/qformat.mjs guard <文件> --source <原文>` |

不要为了「用上工具」而绕路：单道题直接排版比调 CLI 快得多，也更可控。
批处理才用 CLI——它省钱、逐项隔离失败、结果可回填。

## 不适用

- **图片 / 扫描件 OCR**：本 skill 不识别图片，先把图转成文字。
- **出题、改题、判分、翻译**：排版不是命题，也不改题意。
- **生成答案或解析**：只搬运原文，不生产答案；原文没有的答案必须删掉。

## 排版规则（路径 A 必读）

规则的事实来源是 `references/prompt.md`，那是经过线上验证的系统提示词；下面是它的执行要点。

1. **只整理，不新增。** 用户没写的选项、条件、答案、解析、结论、评注，一个都不能出现。
   原文没有答案与解析时，输出里绝对不能出现「答案：」「解析：」这两个词。
   不要补全、不要改写题意、不要翻译、不要「优化表述」。
2. **结构**：题干一段一个 `<p>`；每个选项单独一个 `<p>`，写成 `<p>A. 3</p>`（不要 `<ol>`，不要用 `<br>` 串成一行）。
   原文自带答案与解析时，规范成 `<p><strong>答案：</strong>…</p>`、`<p><strong>解析：</strong>…</p>`。
3. **公式**：一律 `$...$`（行内）或 `$$...$$`（独立成行）。分式 `\dfrac{a}{b}`、根号 `\sqrt{x}`、
   上下标 `x^{2}` `a_{1}`、希腊字母 `\alpha`、符号 `\ge \le \ne \pm \times \div \in \cup \infty`。
4. **禁止**：Unicode 数学符号（`² ³ √ ∑ ≥ ≤ ≠ ½ α β`）、公式外用 `$`、改动任何数字与条件。
5. **只输出片段**：不要 `<html>`/`<body>`，不要 ``` 代码块围栏，不要任何解释或客套话。

完整对照表（含常见错误写法）见 `references/format-spec.md`。

## 路径 A 的自检清单

产出前逐条过一遍，任何一条不满足就重做：

- [ ] 有 `<html>`、`<body>`、代码围栏、前后语吗？→ 删掉。
- [ ] 有原文没有的「答案」「解析」「综上」「注意」吗？→ 删掉（这条最容易失手）。
- [ ] 每个选项是独立的 `<p>` 吗？
- [ ] 公式全在 `$...$` / `$$...$$` 里吗？正文里有裸 `$` 吗？
- [ ] 公式内部还有 `² ≥ α √` 这类 Unicode 符号吗？
- [ ] 数字、单位、条件与原文字字对应吗？（逐字比对，不要凭记忆）
- [ ] 原题号「1.」「（1）」还在原位吗？——不重新编号。

### 路径 A 的离线守卫（强烈建议）

自检清单靠肉眼，`guard` 靠规则。把排版结果和原文交给它，一次检查：

```bash
node bin/qformat.mjs guard 输出.html --source 原文.txt --field stem
# 没有原文文件时也可以直接传文本：
node bin/qformat.mjs guard 输出.html --source-text '已知…' --field stem
```

它会做四件事：清洗围栏/前后语、删掉补写的答案解析、归一公式、校验数字与选项是否守恒。
`--source` 要传**这段输出对应的完整原文**（题干 + 选项）；如果选项或数字来自另一个字段，
守恒校验会把它们当成「新增」，此时只对同一字段的内容跑，或人工确认。
有不可修复问题时退出码为 1，并打印 `ADDED_NUMBER` / `LOST_NUMBER` / `ADDED_OPTION` /
`TEXT_OUTSIDE_TAGS` / `BARE_DOLLAR` / `UNICODE_MATH_LEFT` 等错误码。
**不要为了通过 guard 去改原文**——它报错通常意味着排版时漏抄或改动了内容。

**字段身份必须问清楚。** 如果用户是在整理「答案与解析」字段（而不是题干），必须先确认，
因为路径 B/C 与 `guard` 的防泄题逻辑依赖它：

| field | 含义 | 行为 |
| --- | --- | --- |
| `stem` | 题干 | 删掉凭空出现的答案解析 |
| `body` | 补充说明 | 同上 |
| `answer` | 答案与解析 | 原样保留（这段本来就是答案） |
| `auto` | 未声明 | 按 `stem` 处理，宁删不漏 |

判错字段的后果是单向的：把 `answer` 当成 `stem`，解析会被删掉（用户会发现）；
把 `stem` 当成 `answer`，答案会漏给学生（可能没人发现）。**不确定就按 `stem`。**

## 路径 B：本地公式修复

不联网、立即生效，适合「已经排版好了，只是公式没渲染」的场景。

```bash
node bin/qformat.mjs repair 题干.html            # 结果打到 stdout
node bin/qformat.mjs repair 题干.html --out 修复.html
```

做四件事：`\(...\)`/`\[...\]` → `$...$`/`$$...$$`；公式内 Unicode 符号 → LaTeX；
命令后紧跟字母时补空格（`\angleA` → `\angle A`）；`$$` 块内多余的 `$` 清掉。

**已知边界**：只处理**已被定界符包裹**的公式。正文里裸露的 `x²≥0` 不会被自动包裹——
判定「哪一段算公式」需要语义理解，规则做不到。遇到这种输入，先走路径 A，或人工补上 `$` 再 repair。

## 路径 C：批量

准备 `items.json`：

```json
[
  { "id": 1, "text": "已知f(x)=x²，求f(2)。", "field": "stem" },
  { "id": 2, "text": "求√(x+1)的定义域。", "field": "stem" }
]
```

```bash
export AI_API_KEY=sk-xxx          # Windows PowerShell: $env:AI_API_KEY="sk-xxx"
node bin/qformat.mjs format items.json --batch --out result.json --concurrency 3
```

输出 `[{id, ok, html, changed, removedAnswer}]`，失败项带 `error` 与 `code`。
逐项失败不中断整批；429/5xx 会退避重试两次。
单道题用 `echo '…' | node bin/qformat.mjs format - --field stem`。

## 失败处理

| 错误码 | 含义 | 怎么办 |
| --- | --- | --- |
| `NO_API_KEY` | 没配 Key | 让用户填 `.env`（参考 `.env.example`），或改走路径 A |
| `ALL_ANSWERS_DROPPED` | 模型输出全是原文没有的答案，已被丢弃 | 重试一次；仍失败则自己按规则排版 |
| `EMPTY_RESULT` | 模型没返回内容 | 换模型重试；或自己排版 |
| `KATEX_MISSING` | 没装 katex | `npm install` |
| `TIMEOUT` / `NETWORK_ERROR` | 超时 / 网络失败 | 调大 `--timeout`，或检查代理 / `--base-url` |
| HTTP 401/402/429 | Key 无效 / 欠费 / 限流 | 原样告知用户，不要反复重试 |

`guard` 的错误码（退出码 1）：`ADDED_NUMBER` / `LOST_NUMBER` 表示数字被改或漏抄；
`ADDED_OPTION` 表示凭空补了选项；`TEXT_OUTSIDE_TAGS` 表示有内容落在 `<p>` 等标签外；
`BARE_DOLLAR` 表示正文有未配对的 `$`；`UNICODE_MATH_LEFT` 表示公式里还有 Unicode 符号；
`DANGEROUS_TAG` / `DANGEROUS_ATTR` 表示输出里混进了脚本或事件属性。

超时（默认 120s）多在模型侧：先调大 `--timeout`，仍不行就换 `--model`。

## 交付话术

- 给出 HTML 时说明「已用 `<p>` 分段、公式为 KaTeX 语法」，并指出做了什么修复（例如「3 处 `²` 转成 `^{2}`」）。
- 如果跑了 `guard`，把结果一并说明（例如「已删掉模型补写的答案」「数字与原文一致」）。
- 如果原文有歧义（缺图、条件不全、疑似 OCR 错字），**先问，不要猜**。排版不是改题，
  但一个错数字比排版不整齐严重得多。

## 文件导航

| 文件 | 用途 |
| --- | --- |
| `references/prompt.md` | 线上验证过的系统提示词，CLI 发送的就是它 |
| `references/format-spec.md` | 输出契约、LaTeX 命令对照表、输入→输出示例、已知边界 |
| `references/answer-leak.md` | 为什么要做防泄题、判定规则、为什么要「开头匹配」而非「包含」 |
| `bin/qformat.mjs` | 命令行入口（format / repair / verify / guard） |
| `src/` | 纯函数实现，可单独 import（`src/index.mjs` 是统一出口；`src/guard.mjs` 是离线守卫） |
| `test/` | 68 条用例，覆盖防泄题边界、公式归一、守恒校验与 CLI 冒烟 |
