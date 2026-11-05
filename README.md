# question-format-skill

把「从 Word、聊天记录、OCR 里粘来的」数学题目文本，整理成结构规范、公式能渲染的 HTML 富文本。

它是一个 **Agent Skill**（给 Claude Code / WorkBuddy 等编码 Agent 用的技能包），也是一个 **DeepSeek Harness 插件**，还可以**当命令行工具单独用**。

```
输入   已知f(x)=x²-2x+3，求f(2)的值。A.1 B.3 C.5 D.7
                    ↓
输出   <p>已知 $f(x)=x^{2}-2x+3$，求 $f(2)$ 的值。</p>
       <p>A. 1</p><p>B. 3</p><p>C. 5</p><p>D. 7</p>
```

## 为什么不是「一句提示词」就够

提示词能解决 90% 的情况，剩下 10% 是功能性事故：

| 问题 | 后果 | 本项目的处理 |
| --- | --- | --- |
| 模型主动补出「答案：4」「解析：…」 | 题干直接展示给学生 = **泄题** | 代码级截断（`src/strip-answer.mjs`），不依赖模型自觉 |
| 公式里留 `² √ ≥ α` | 页面显示乱码，KaTeX 不渲染 | Unicode → LaTeX 映射表，纯本地修复 |
| 混用 `\(...\)` / `\[...\]` / `$...$` | 同一份内容两套定界符，清洗逻辑分裂 | 统一归一为 `$...$` / `$$...$$` |
| 选项用 `<br>` 串成一行 | 无法按选项切分、分页测量 | 规范为每选项一个 `<p>` |
| 输出带 ```` ```html ```` 围栏或 `<html>` 外壳 | 落库后页面结构被污染 | 清洗链第一道就去掉 |
| 模型改了数字、漏抄条件、凭空加选项 | 比排版不整齐严重得多 | `guard` 做数字/选项守恒校验 |
| 输出带 `<script>` / `onerror` / `javascript:` | 预览页 XSS | `guard` 检测，`sanitize` 白名单清除 |

前两条是关键：**能靠规则的绝不交给模型，能确定性验证的绝不靠肉眼**。`guard` 把后半句落到了数字与选项上。

## 安装

```bash
git clone https://github.com/eat-li/question-format-skill.git
cd question-format-skill
npm install        # 只为 verify 命令装 katex；不用 verify 可跳过
```

要求 Node.js ≥ 18.13（依赖内置 `fetch`）。运行时**零第三方依赖**。
`.env` 放在当前工作目录或 skill 根目录都可以；CLI 先读 cwd，再读 skill 根目录，不覆盖已有环境变量。

## 六种用法

### 0. 作为 DeepSeek Harness 插件

仓库本身就是 dsh bundle 插件包（`dsh.bundle.patch` → `cordis.patch.yml`），装进 dsh profile 后会提供：

| 能力 | 触发语 | 是否联网 |
| --- | --- | --- |
| 技能 `question-format` | 「整理题目格式」「把公式改成能渲染的写法」 | 否 |
| 工具 `question_format_guard` | 「检查排版有没有改坏」「交付前自检」「别泄题」 | 否 |
| 工具 `question_format_repair` | 「公式渲染不出来」「KaTeX 报错」 | 否 |
| 工具 `question_format_sanitize` | 「去掉富文本垃圾标签」「能直接落库吗」 | 否 |

安装（DSH Desktop 里用 **Settings → Plugins** 装；命令行则要两步）：

```bash
# ① 把包放进 profile 的 node_modules
dsh plugin --profile desktop add file:/绝对路径/question-format-skill
# ② 把包名加进该 profile 的 dsh.profile.bundles
node -e "const f='C:/Users/你/.dsh/profiles/desktop/package.json',j=require(f);j.dsh.profile.bundles.includes('question-format-skill')||j.dsh.profile.bundles.push('question-format-skill');require('fs').writeFileSync(f,JSON.stringify(j,null,2)+'\n')"
```

`dsh plugin add` 只负责装依赖，**不会**把包名写进 `dsh.profile.bundles`；漏了第二步 dsh 启动时不会加载它的 bundle patch，插件静默不生效。

本地开发可以用 overlay 不动 profile：

```bash
dsh --profile <你的 profile> --patch ./dev-overlay.yml   # 见下
```

插件层是纯 Node 的（`lib/host.mjs` 不 import 任何 `@deepseek-ai/*`），所以不需要双端构建，也不受宿主版本兼容检查影响。
技能正文直接读包内 `SKILL.md`，`resourceBase` 指向包根，因此 `references/*.md` 的相对路径能被模型解析。

### 1. 作为 Agent Skill

把仓库目录（或其中的 `SKILL.md` + `references/` + `bin/`）放进 Agent 的 skills 目录，
例如 `~/.claude/skills/question-format/`。Agent 会在识别到「整理题目格式」类请求时自动加载。

`SKILL.md` 里写明了执行路径、硬性规则与自检清单——**单道题由 Agent 直接排版，不需要 API Key**；
交付前用 `guard` 做一遍离线校验。

### 2. 命令行：AI 排版

```bash
cp .env.example .env      # 填入 AI_API_KEY
# 任何 OpenAI 兼容服务都行：DeepSeek / OpenAI / Moonshot / 本地 Ollama …

echo '已知f(x)=x²-2x+3，求f(2)的值。' | node bin/qformat.mjs format - --field stem
```

批量：

```bash
node bin/qformat.mjs format items.json --batch --out result.json --concurrency 3 --resume
```

批量默认启用结果缓存（`.qformat-cache/`），同一段文本 + 字段 + 模型 + 提示词不会重复计费；
用 `--no-cache` 关闭，或用 `--cache-dir <目录>` 改位置。`--resume` 会读取上次的
`result.json` / `result.json.partial`，按 `id + 输入哈希` 跳过 `ok:true` 且内容未变的项，只重跑失败或改动项；
运行中每完成一项就写一次 `.partial`，进程中断也不会丢整批。

`items.json`：

```json
[
  { "id": 1, "text": "已知f(x)=x²，求f(2)。", "field": "stem" },
  { "id": 2, "text": "求√(x+1)的定义域。", "field": "stem" }
]
```

输出 `[{ id, ok, html, changed, removedAnswer, cached, resumed, inputHash }]`，单项失败不中断整批；429/5xx 退避重试两次。
`--max-tokens` 控制单次回复上限（默认 4096），长答案/解析可以调大。

### 3. 命令行：本地公式修复（不联网）

```bash
node bin/qformat.mjs repair 题干.html --out 修复.html
node bin/qformat.mjs verify 修复.html     # KaTeX 逐段校验，失败退出码 1
```

### 4. 命令行：离线守卫（路径 A 的兜底）

```bash
node bin/qformat.mjs guard 整理后.html --source 原文.txt --field stem
# 也可以直接传原文：
node bin/qformat.mjs guard 整理后.html --source-text '已知f(x)=x²，求f(2)。' --field stem
```

`guard` 会顺带清洗围栏/前后语、删掉补写的答案、归一公式，然后检查：

- 数字守恒（`errors`: `ADDED_NUMBER` / `LOST_NUMBER`；`warnings`: `NUMBER_COUNT_DROPPED` / `NUMBER_COUNT_ADDED`）
- 选项守恒（`ADDED_OPTION`）
- 标签外裸文本（`TEXT_OUTSIDE_TAGS`）
- 裸 `$`、残留 Unicode 数学符号
- `script` / `on*` / `javascript:` / 内联 `style`

`errors` 让退出码变成 1；`warnings` 只打到 stderr，不阻断流水线——它是「同一数字出现次数变了，
可能题号被吞」的提示，需要人看一眼再决定。

有不可修复问题时退出码 1。它适合 Agent 直接排版（不花 API 费用）之后跑一遍。
`--source` 必须是这段输出对应的完整原文（题干 + 选项）；如果选项/数字来自另一个字段，
守恒校验会把它们当成「新增」，此时只对同一字段跑，或人工确认。

### 5. 命令行：HTML 消毒（不联网）

```bash
node bin/qformat.mjs sanitize 整理后.html --out 安全.html
# 也可以让 guard 一并消毒：
node bin/qformat.mjs guard 整理后.html --source 原文.txt --sanitize
```

`sanitize` 只保留 `format-spec.md` 允许的标签，删除 `script/style/iframe` 等危险标签，
去掉 `on*`、内联 `style`、`javascript:` 链接；图片只保留 `src`（http/https/相对路径/位图 data URL）、
`alt`、`width`、`height`。

## 命令参考

| 命令 | 作用 | 需要网络 |
| --- | --- | --- |
| `format <输入>` | 调模型排版，返回规范 HTML | 是 |
| `format <输入> --batch` | 批量排版 JSON 数组 | 是 |
| `repair <输入>` | Unicode → LaTeX、定界符归一 | 否 |
| `verify <输入>` | KaTeX 校验，输出失败公式清单 | 否 |
| `guard <输入> --source <原文>` | 清洗 + 防泄题 + 归一 + 守恒校验 | 否 |
| `sanitize <输入>` | HTML 白名单消毒（去脚本/事件属性） | 否 |

`<输入>` 为文件路径，`-` 表示 stdin。常用参数：`--field`、`--source`、`--source-text`、`--sanitize`、
`--out`、`--json`、`--concurrency`、`--resume`、`--no-cache`、`--cache-dir`、`--max-tokens`、
`--api-key`、`--base-url`、`--model`、`--timeout`。完整见 `node bin/qformat.mjs --help`。

## 作为库调用

```js
import {
  formatQuestion,
  normalizeAiMathHtml,
  stripUnrequestedAnswer,
  guardHtml,
  sanitizeHtml
} from './src/index.mjs'

const { html, dropped } = await formatQuestion({
  text: '已知f(x)=x²，求f(2)。',
  field: 'stem',            // stem | body | answer | auto
  apiKey: process.env.AI_API_KEY
})

const { html: fixed, changed } = normalizeAiMathHtml(html)

// Agent 自己排版后，用同一套规则守一遍
const result = guardHtml({ sourceText: '已知f(x)=x²，求f(2)。', html: fixed, field: 'stem' })
if (!result.ok) console.log(result.errors)

const safe = sanitizeHtml(html)
```

`postProcess(raw, sourceText, field)` 可单独复用——你已经有了自己的模型调用，只想借用后处理链。
`stripUnrequestedAnswerDetailed` 会额外返回 `removed`，便于宿主记录「本次删掉了补写的答案」。
`buildSystemPrompt(field)` 会把字段规则追加到基础提示词；`formatCacheKey` / `readCache` / `writeCache`
可用于自己的批量管线。

## 设计取舍

- **`field` 是必填心智**：处理链必须知道这段内容属于题干还是答案解析，否则无法安全判断
  「多出来的答案该不该删」。判错方向是不对称的：把答案当题干，解析被删（用户会发现）；
  把题干当答案，答案漏给学生。所以默认偏保守。
- **只删「整段以答案标记开头」的内容**，不做「包含即删」。后者会把
  `…求 f(2) 的值。答案：5` 整段删掉，题干一起消失——误删比漏删更难发现。
- **原文判定不再看「答案 / 解析」裸子串**。数学题干里的「解析式」「解析几何」曾经会让兜底整体失效；
  现在只认「【答案】」「答案：」「答案是」等真正的答案标记。原文只提「把答案填在横线上」时，
  模型补写的答案仍会被删掉。
- **命令边界是硬性修复**。Unicode 映射后 `∠A` 会变成 `\angleA`（KaTeX 报未定义命令），
  所以替换后会在已知命令和后续字母之间补空格：`\angle A`、`\alpha x`、`\in A`。
- **`repair` 只处理已包裹的公式**。正文里裸露的 `x²≥0` 不会被自动加定界符：
  「哪一段算公式」需要语义理解，规则做不到，硬猜会切碎题干。这条已写进
  `references/format-spec.md` 的已知边界。
- **数字与选项也要守恒**。`guard` 对比原文和输出的数字出现次数、选项字母；改数字、漏抄条件、
  凭空补选项、丢掉选项都会报 `errors`（退出码 1）。次数不一致但数值没变（最常见的是题号被吞）
  报 `warnings`，不改退出码——它需要人判断是不是排版事故。等价写法（`1,000`/`1000`、
  `１２`/`12`、`3.5万`/`3.5\times 10^{4}`）按同一个数比对，不算改题。
  它不判断语义是否正确，只守住「排版不是改题」这条线。
- **字段身份也告诉模型**。基础提示词之外，`buildSystemPrompt(field)` 会追加「本次是题干/答案」，
  减少模型在题干里补答案；后处理截断仍是最后一道确定性防线。
- **缓存键覆盖提示词**。缓存包含文本、字段、模型、温度、maxTokens 和系统提示词哈希；
  改提示词或换模型会自动失效，`--no-cache` 可强制重新生成。
- **消毒只做白名单**。`sanitize` 不是完整浏览器级 sanitizer，但覆盖 `script/style/iframe`、
  `on*`、`javascript:`、内联 `style` 和图片危险 URL；未知标签拆掉保文字。
- **提示词与代码分离**。`references/prompt.md` 是基础提示词，CLI 运行时读取它；字段规则由
  `buildSystemPrompt(field)` 追加。改基础提示词不用动代码，也不会出现「文档写一套、实际发另一套」。

## 改造为其它学科

公式部分（LaTeX 映射、定界符归一、KaTeX 校验、数字/选项守恒）与学科无关，可直接沿用。
需要改的是 `references/prompt.md` 里的结构约定（例如化学的方程式配平写作要求、
英语的选项排版），以及 `references/format-spec.md` 的命令对照表。

## 测试

```bash
npm test                              # node --test，124 条用例，零网络依赖
npm run test:inprocess                # 同一套用例在进程内跑（沙箱禁止 spawn 时用）
```

覆盖：围栏/外壳清洗、定界符归一、Unicode 转 LaTeX 与命令边界、含 `<` 的不等式、
防泄题的多种边界（故答案为 / 正确答案 / 故选 / 无冒号 / 逗号后 / 解析式误判）、
数字与选项守恒（含丢失选项、千分位与全角数字等价、题号被吞）、HTML 消毒、缓存键与读写、
字段提示、金样本（真实题库形态的原文→HTML 成对用例）、dsh 插件宿主（工具注册形状、
技能 provider 契约、单个服务缺失时的降级），以及 CLI 的
repair / guard / sanitize / 批量缓存 / 断点续跑冒烟。CI 见 `.github/workflows/ci.yml`
（Node 18/20/22/24 × Ubuntu/Windows）。

`test/cli.test.mjs` 会先探测能否 `spawn` 子进程：在禁止 spawn 的沙箱里整组标记为 skipped
而不是失败——那是环境限制，不是代码缺陷。

## 安全边界

`qformat sanitize` 提供白名单消毒，`guard --sanitize` 可以检查 + 消毒一次完成，覆盖常见 XSS 入口。
它不是浏览器级 sanitizer：如果宿主还允许 `class`、`data-*`、外链样式或 MathML，需要在宿主侧再跑一遍
自己的策略。题干来自不可信来源时，至少要在落库/渲染前跑一次 `sanitize`。

## 目录结构

```
SKILL.md                    Agent 读的入口：解决什么、走哪条路、排版规则、自检清单
references/
  usage.md                  命令详解、失败码与提示码、交付话术
  prompt.md                 系统提示词（唯一事实来源）
  format-spec.md            输出契约 + LaTeX 对照表 + 示例 + 已知边界
  answer-leak.md            防泄题的设计说明
src/
  index.mjs                 统一出口：formatQuestion / postProcess / guardHtml / sanitizeHtml
  clean.mjs                 清洗：去围栏、去外壳、定界符归一、标签配平
  strip-answer.mjs          防泄题截断（含详细接口）
  normalize-math.mjs        Unicode → LaTeX、公式扫描
  guard.mjs                 离线守卫：守恒校验与危险标签检查
  sanitize.mjs              HTML 白名单消毒
  cache.mjs                 结果缓存（键含提示词哈希）
  validate-math.mjs         KaTeX 校验（可选依赖）
  client.mjs                OpenAI 兼容调用层
  prompt.mjs               提示词加载 + 字段规则
  env.mjs                   极简 .env 读取
bin/qformat.mjs             CLI
lib/host.mjs                dsh 插件宿主：注册三个离线工具 + question-format 技能
cordis.patch.yml            dsh bundle patch（把本包插进 profile 层栈）
test/                       124 条用例（含金样本、插件宿主、CLI 与批量缓存/续跑冒烟）
```

## License

MIT
