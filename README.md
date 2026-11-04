# question-format-skill

把「从 Word、聊天记录、OCR 里粘来的」数学题目文本，整理成结构规范、公式能渲染的 HTML 富文本。

它是一个 **Agent Skill**（给 Claude Code / WorkBuddy 等编码 Agent 用的技能包），也可以**当命令行工具单独用**。

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

前两条是关键：**能靠规则的绝不交给模型，能确定性验证的绝不靠肉眼**。`guard` 把后半句落到了数字与选项上。

## 安装

```bash
git clone https://github.com/eat-li/question-format-skill.git
cd question-format-skill
npm install        # 只为 verify 命令装 katex；不用 verify 可跳过
```

要求 Node.js ≥ 18.13（依赖内置 `fetch`）。运行时**零第三方依赖**。
`.env` 放在当前工作目录或 skill 根目录都可以；CLI 先读 cwd，再读 skill 根目录，不覆盖已有环境变量。

## 四种用法

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
node bin/qformat.mjs format items.json --batch --out result.json --concurrency 3
```

`items.json`：

```json
[
  { "id": 1, "text": "已知f(x)=x²，求f(2)。", "field": "stem" },
  { "id": 2, "text": "求√(x+1)的定义域。", "field": "stem" }
]
```

输出 `[{ id, ok, html, changed, removedAnswer }]`，单项失败不中断整批；429/5xx 退避重试两次。

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

- 数字守恒（`ADDED_NUMBER` / `LOST_NUMBER`）
- 选项守恒（`ADDED_OPTION`）
- 标签外裸文本（`TEXT_OUTSIDE_TAGS`）
- 裸 `$`、残留 Unicode 数学符号
- `script` / `on*` / `javascript:` / 内联 `style`

有不可修复问题时退出码 1。它适合 Agent 直接排版（不花 API 费用）之后跑一遍。
`--source` 必须是这段输出对应的完整原文（题干 + 选项）；如果选项/数字来自另一个字段，
守恒校验会把它们当成「新增」，此时只对同一字段跑，或人工确认。

## 命令参考

| 命令 | 作用 | 需要网络 |
| --- | --- | --- |
| `format <输入>` | 调模型排版，返回规范 HTML | 是 |
| `format <输入> --batch` | 批量排版 JSON 数组 | 是 |
| `repair <输入>` | Unicode → LaTeX、定界符归一 | 否 |
| `verify <输入>` | KaTeX 校验，输出失败公式清单 | 否 |
| `guard <输入> --source <原文>` | 清洗 + 防泄题 + 归一 + 守恒校验 | 否 |

`<输入>` 为文件路径，`-` 表示 stdin。常用参数：`--field`、`--source`、`--source-text`、`--out`、`--json`、
`--concurrency`、`--api-key`、`--base-url`、`--model`、`--timeout`。完整见 `node bin/qformat.mjs --help`。

## 作为库调用

```js
import {
  formatQuestion,
  normalizeAiMathHtml,
  stripUnrequestedAnswer,
  guardHtml
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
```

`postProcess(raw, sourceText, field)` 可单独复用——你已经有了自己的模型调用，只想借用后处理链。
`stripUnrequestedAnswerDetailed` 会额外返回 `removed`，便于宿主记录「本次删掉了补写的答案」。

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
- **数字与选项也要守恒**。`guard` 对比原文和输出的数字集合、选项字母；改数字、漏抄条件、
  凭空补选项都会报错。它不判断语义是否正确，只守住「排版不是改题」这条线。
- **提示词与代码分离**。`references/prompt.md` 是唯一事实来源，CLI 运行时读取它，
  改提示词不用动代码，也不会出现「文档写一套、实际发另一套」。

## 改造为其它学科

公式部分（LaTeX 映射、定界符归一、KaTeX 校验、数字/选项守恒）与学科无关，可直接沿用。
需要改的是 `references/prompt.md` 里的结构约定（例如化学的方程式配平写作要求、
英语的选项排版），以及 `references/format-spec.md` 的命令对照表。

## 测试

```bash
npm test     # node --test，68 条用例，零网络依赖
```

覆盖：围栏/外壳清洗、定界符归一、Unicode 转 LaTeX 与命令边界、含 `<` 的不等式、
防泄题的多种边界（故答案为 / 正确答案 / 故选 / 无冒号 / 逗号后 / 解析式误判）、
数字与选项守恒、危险标签、CLI 的 repair / guard 冒烟。CI 见 `.github/workflows/ci.yml`
（Node 18/20/22 × Ubuntu/Windows）。

## 安全边界

`guard` 会拒绝 `script` / `on*` / `javascript:` / 内联 `style`，但它不是完整的 HTML 消毒器。
输出落库或渲染前，宿主仍应跑一遍白名单 sanitizer——尤其是题干来自不可信来源时。

## 目录结构

```
SKILL.md                    Agent 读的入口：路径选择、规则、自检清单、失败处理
references/
  prompt.md                 系统提示词（唯一事实来源）
  format-spec.md            输出契约 + LaTeX 对照表 + 示例 + 已知边界
  answer-leak.md            防泄题的设计说明
src/
  index.mjs                 统一出口：formatQuestion / postProcess / guardHtml
  clean.mjs                 清洗：去围栏、去外壳、定界符归一、标签配平
  strip-answer.mjs          防泄题截断（含详细接口）
  normalize-math.mjs        Unicode → LaTeX、公式扫描
  guard.mjs                 离线守卫：守恒校验与危险标签检查
  validate-math.mjs         KaTeX 校验（可选依赖）
  client.mjs                OpenAI 兼容调用层
  prompt.mjs               提示词加载
  env.mjs                   极简 .env 读取
bin/qformat.mjs             CLI
test/                       68 条用例（含 CLI 冒烟）
```

## License

MIT
