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

前两条是关键：**能靠规则的绝不交给模型，能确定性验证的绝不靠肉眼**。

## 安装

```bash
git clone <本仓库地址> question-format-skill
cd question-format-skill
npm install        # 只为 verify 命令装 katex；不用 verify 可跳过
```

要求 Node.js ≥ 18.13（依赖内置 `fetch`）。运行时**零第三方依赖**。

## 三种用法

### 1. 作为 Agent Skill

把仓库目录（或其中的 `SKILL.md` + `references/` + `bin/`）放进 Agent 的 skills 目录，
例如 `~/.claude/skills/question-format/`。Agent 会在识别到「整理题目格式」类请求时自动加载。

`SKILL.md` 里写明了三条执行路径、硬性规则与自检清单——**单道题由 Agent 直接排版，不需要 API Key**。

### 2. 命令行：AI 排版

```bash
cp .env.example .env      # 填入 AI_API_KEY
# 任何 OpenAI 兼容服务都行：DeepSeek / OpenAI / Moonshot / 本地 Ollama …

echo '已知f(x)=x²-2x+3，求f(2)的值。' | node bin/qformat.mjs format - --field stem
```

批量：

```bash
node bin/qformat.mjs format items.json --batch --out result.json
```

`items.json`：

```json
[
  { "id": 1, "text": "已知f(x)=x²，求f(2)。", "field": "stem" },
  { "id": 2, "text": "求√(x+1)的定义域。", "field": "stem" }
]
```

输出 `[{ id, ok, html, changed }]`，单项失败不中断整批。

### 3. 命令行：本地公式修复（不联网）

```bash
node bin/qformat.mjs repair 题干.html --out 修复.html
node bin/qformat.mjs verify 修复.html     # KaTeX 逐段校验，失败退出码 1
```

## 命令参考

| 命令 | 作用 | 需要网络 |
| --- | --- | --- |
| `format <输入>` | 调模型排版，返回规范 HTML | 是 |
| `format <输入> --batch` | 批量排版 JSON 数组 | 是 |
| `repair <输入>` | Unicode → LaTeX、定界符归一 | 否 |
| `verify <输入>` | KaTeX 校验，输出失败公式清单 | 否 |

`<输入>` 为文件路径，`-` 表示 stdin。常用参数：`--field`、`--out`、`--json`、
`--api-key`、`--base-url`、`--model`、`--timeout`。完整见 `node bin/qformat.mjs --help`。

## 作为库调用

```js
import { formatQuestion, normalizeAiMathHtml, stripUnrequestedAnswer } from './src/index.mjs'

const { html, dropped } = await formatQuestion({
  text: '已知f(x)=x²，求f(2)。',
  field: 'stem',            // stem | body | answer | auto
  apiKey: process.env.AI_API_KEY
})

const { html: fixed, changed } = normalizeAiMathHtml(html)
```

`postProcess(raw, sourceText, field)` 可单独复用——你已经有了自己的模型调用，只想借用后处理链。

## 设计取舍

- **`field` 是必填心智**：处理链必须知道这段内容属于题干还是答案解析，否则无法安全判断
  「多出来的答案该不该删」。判错方向是不对称的：把答案当题干，解析被删（用户会发现）；
  把题干当答案，答案漏给学生。所以默认偏保守。
- **只删「整段以答案标记开头」的内容**，不做「包含即删」。后者会把
  `…求 f(2) 的值。答案：5` 整段删掉，题干一起消失——误删比漏删更难发现。
- **`repair` 只处理已包裹的公式**。正文里裸露的 `x²≥0` 不会被自动加定界符：
  「哪一段算公式」需要语义理解，规则做不到，硬猜会切碎题干。这条已写进
  `references/format-spec.md` 的已知边界。
- **提示词与代码分离**。`references/prompt.md` 是唯一事实来源，CLI 运行时读取它，
  改提示词不用动代码，也不会出现「文档写一套、实际发另一套」。

## 改造为其它学科

公式部分（LaTeX 映射、定界符归一、KaTeX 校验）与学科无关，可直接沿用。
需要改的是 `references/prompt.md` 里的结构约定（例如化学的方程式配平写作要求、
英语的选项排版），以及 `references/format-spec.md` 的命令对照表。

## 测试

```bash
npm test     # node --test，31 条用例，零网络依赖
```

覆盖：围栏/外壳清洗、定界符归一、Unicode 转 LaTeX、防泄题的 6 种边界
（放行、原文自带、整段截断、同行截断保标点、整份皆答案、正常输出不误伤）、
编排顺序与错误码。CI 见 `.github/workflows/ci.yml`。

## 目录结构

```
SKILL.md                    Agent 读的入口：路径选择、规则、自检清单、失败处理
references/
  prompt.md                 系统提示词（唯一事实来源）
  format-spec.md            输出契约 + LaTeX 对照表 + 示例 + 已知边界
  answer-leak.md            防泄题的设计说明
src/
  index.mjs                 统一出口：formatQuestion / postProcess
  clean.mjs                 清洗：去围栏、去外壳、定界符归一、标签配平
  strip-answer.mjs          防泄题截断
  normalize-math.mjs        Unicode → LaTeX
  validate-math.mjs         KaTeX 校验（可选依赖）
  client.mjs                OpenAI 兼容调用层
  prompt.mjs               提示词加载
  env.mjs                   极简 .env 读取
bin/qformat.mjs             CLI
test/                       31 条用例
```

## License

MIT
