# 用法详解（SKILL.md 的配套手册）

SKILL.md 只放「必须每次都看到」的规则；命令细节、失败码、交付话术在这里按需查。

## 路径决策

| 情况 | 走哪条 | 怎么做 |
| --- | --- | --- |
| 用户给了题目文本，要整理格式（1 道或几道） | **A. 你直接排版** | 按 SKILL.md 的「排版规则」自己产出 HTML，**交付前跑 `guard`**；不需要 API Key |
| 用户已有 HTML，只想修公式（Unicode 残留、`\(...\)` 混用） | **B. 本地修复** | `node bin/qformat.mjs repair <文件>` |
| 用户有几十上百道题要批量处理 | **C. CLI 批处理** | `node bin/qformat.mjs format <items.json> --batch`（需要 API Key） |
| 已有 HTML，想确认公式能不能渲染 | **校验** | `node bin/qformat.mjs verify <文件>`（需 `npm i`） |
| 已有 HTML，想确认没泄题、没改数字 | **守卫** | `node bin/qformat.mjs guard <文件> --source <原文>` |
| 已有 HTML，想清掉脚本/事件属性 | **消毒** | `node bin/qformat.mjs sanitize <文件>` |

不要为了「用上工具」而绕路：单道题直接排版比调 CLI 快得多。批处理才用 CLI——它省钱、逐项隔离失败、结果可回填。

## 字段身份（field）

| field | 含义 | 行为 |
| --- | --- | --- |
| `stem` | 题干 | 删掉凭空出现的答案解析 |
| `body` | 补充说明 | 同上 |
| `answer` | 答案与解析 | 原样保留（这段本来就是答案） |
| `auto` | 未声明 | 按 `stem` 处理，宁删不漏 |

判错字段的后果是单向的：把 `answer` 当成 `stem`，解析会被删掉（用户会发现）；把 `stem` 当成 `answer`，答案会漏给学生（可能没人发现）。**不确定就按 `stem`。**

## 路径 A 的离线守卫

```bash
node bin/qformat.mjs guard 输出.html --source 原文.txt --field stem
# 没有原文文件时也可以直接传文本：
node bin/qformat.mjs guard 输出.html --source-text '已知…' --field stem
# 检查 + 白名单消毒一次完成：
node bin/qformat.mjs guard 输出.html --source 原文.txt --field stem --sanitize
```

它做五件事：清洗围栏/前后语、删掉补写的答案解析、归一公式、校验数字与选项是否守恒、
（加 `--sanitize` 时）按白名单清掉脚本/事件属性/危险链接。

`--source` 要传**这段输出对应的完整原文**（题干 + 选项）；如果选项或数字来自另一个字段，
守恒校验会把它们当成「新增」，此时只对同一字段的内容跑，或人工确认。
**不要为了通过 guard 去改原文**——它报错通常意味着排版时漏抄或改动了内容。

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
node bin/qformat.mjs format items.json --batch --out result.json --concurrency 3 --resume
```

输出 `[{id, ok, html, changed, removedAnswer, cached, resumed, inputHash}]`，失败项带 `error` 与 `code`。
逐项失败不中断整批；429/5xx 会退避重试两次。默认使用 `.qformat-cache/` 缓存，
同一文本 + 字段 + 模型 + 提示词不会重复计费；`--no-cache` 关闭，`--cache-dir` 改位置。
`--resume` 按 `id + 输入哈希` 跳过 `ok:true` 且内容未变的项，只重跑失败或改动项；每完成一项会写 `result.json.partial`，
中断后不丢整批。长答案/解析可用 `--max-tokens` 调大回复上限。
单道题用 `echo '…' | node bin/qformat.mjs format - --field stem`。

## 失败处理

| 错误码 | 含义 | 怎么办 |
| --- | --- | --- |
| `NO_API_KEY` | 没配 Key | 让用户填 `.env`（参考 `.env.example`），或改走路径 A |
| `ALL_ANSWERS_DROPPED` | 模型输出全是原文没有的答案，已被丢弃 | 重试一次；仍失败则自己按规则排版 |
| `EMPTY_RESULT` | 模型没返回内容 | 换模型重试；或自己排版 |
| `KATEX_MISSING` | 没装 katex | `npm install` |
| `TIMEOUT` / `NETWORK_ERROR` | 超时 / 网络失败 | 调大 `--timeout`，或检查代理 / `--base-url` |
| `BAD_RESPONSE` | 上游返回的不是合法 JSON | 检查 `--base-url` 或中转服务 |
| `INVALID_FIELD` | 批量项里的 `field` 不合法 | 改成 stem / body / answer / auto |
| HTTP 401/402/429 | Key 无效 / 欠费 / 限流 | 原样告知用户，不要反复重试 |

超时（默认 120s）多在模型侧：先调大 `--timeout`，仍不行就换 `--model`。

### guard 的错误与提示

错误（退出码 1，必须修）：

| 错误码 | 含义 |
| --- | --- |
| `ADDED_NUMBER` / `LOST_NUMBER` | 数字被改、或多出一个、或漏抄 |
| `ADDED_OPTION` / `LOST_OPTION` | 凭空补了选项，或丢了选项 |
| `TEXT_OUTSIDE_TAGS` | 有内容落在 `<p>` 等标签外 |
| `BARE_DOLLAR` | 正文有未配对的 `$` |
| `UNICODE_MATH_LEFT` | 公式里还有 Unicode 符号 |
| `DANGEROUS_TAG` / `DANGEROUS_ATTR` / `DANGEROUS_URL` / `INLINE_STYLE` | 混进了脚本、事件属性、`javascript:` 链接或内联样式 |
| `ALL_ANSWERS_DROPPED` / `EMPTY_RESULT` | 输出整段都是补写的答案，或输出为空 |

提示（`warnings`，不改退出码，需要人判断）：

| 提示码 | 含义 |
| --- | --- |
| `NUMBER_COUNT_DROPPED` | 某个数字出现次数变少——最常见的原因是**题号被吞**（`1. 求f(1)` → `求f(1)`） |
| `NUMBER_COUNT_ADDED` | 某个数字出现次数变多，常见于模型顺手把同一条件写了两遍 |

换算过的等价写法**不算**改题：`1,000` 与 `1000`、`１２` 与 `12`、`3.5万` 与 `3.5\times 10^4` 都按同一个数比对。
反过来，`50%` → `\dfrac{1}{2}` 这种改写**会**被报出来——它确实改了题面写法，请保持原样。

括号里的逗号按分隔符处理：`[1,200]`、`(1, 200)`、`{1,200}` 是区间/坐标/集合，不是 1200；
所以模型在逗号后加空格（`[1,200]` → `[1, 200]`）不算改题。只有括号外、且恰好三位一组的
逗号（`标价1,200元`）才当千分位。

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
| `bin/qformat.mjs` | 命令行入口（format / repair / verify / guard / sanitize） |
| `src/` | 纯函数实现，可单独 import（`src/index.mjs` 是统一出口；`src/guard.mjs` 是离线守卫；`src/sanitize.mjs` 是消毒器） |
| `test/` | 用例覆盖防泄题边界、公式归一、守恒校验、HTML 消毒、缓存与 CLI 冒烟 |
