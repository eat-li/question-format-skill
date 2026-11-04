// 公式规范化：Unicode 数学符号 → LaTeX，定界符归一，$$ 块内多余 $ 清理。
//
// 纯本地、不联网、立即生效——AI 排版失败或超时时，这是唯一能让老师继续干活的路径。
// 已知边界：替换只发生在 $...$ / $$...$$ **内部**。正文里裸露的 `x²≥0` 不会被自动包裹，
// 因为「哪一段算公式」需要语义理解，规则做不到（见 references/format-spec.md 第 5 节）。

/** Unicode 数学符号 → LaTeX 命令（模型输出公式时最常见的错误） */
export const UNICODE_MATH = {
  '²': '^2',
  '³': '^3',
  '⁴': '^4',
  '⁵': '^5',
  '⁶': '^6',
  '⁷': '^7',
  '⁸': '^8',
  '⁹': '^9',
  '⁰': '^0',
  '₁': '_{1}',
  '₂': '_{2}',
  '₃': '_{3}',
  '₄': '_{4}',
  '₅': '_{5}',
  '₆': '_{6}',
  '₇': '_{7}',
  '₈': '_{8}',
  '₉': '_{9}',
  '₀': '_{0}',
  ⁿ: '^{n}',
  '⁺': '^{+}',
  '⁻': '^{-}',
  '∑': '\\sum',
  '∏': '\\prod',
  '∞': '\\infty',
  '∫': '\\int',
  '≥': '\\ge',
  '≤': '\\le',
  '≧': '\\ge',
  '≦': '\\le',
  '≠': '\\ne',
  '≈': '\\approx',
  '≡': '\\equiv',
  '±': '\\pm',
  '×': '\\times',
  '÷': '\\div',
  '·': '\\cdot',
  '∈': '\\in',
  '∉': '\\notin',
  '⊂': '\\subset',
  '⊆': '\\subseteq',
  '∪': '\\cup',
  '∩': '\\cap',
  '∅': '\\varnothing',
  '∀': '\\forall',
  '∃': '\\exists',
  '∠': '\\angle',
  '⊥': '\\perp',
  '∥': '\\parallel',
  '△': '\\triangle',
  '□': '\\square',
  '⊙': '\\odot',
  '≅': '\\cong',
  '≌': '\\cong',
  '∴': '\\therefore',
  '∵': '\\because',
  α: '\\alpha',
  β: '\\beta',
  γ: '\\gamma',
  δ: '\\delta',
  ε: '\\varepsilon',
  θ: '\\theta',
  λ: '\\lambda',
  μ: '\\mu',
  π: '\\pi',
  σ: '\\sigma',
  φ: '\\varphi',
  ω: '\\omega',
  Δ: '\\Delta',
  Σ: '\\Sigma',
  Φ: '\\Phi',
  Ω: '\\Omega',
  '→': '\\to',
  '←': '\\leftarrow',
  '⇒': '\\Rightarrow',
  '⇔': '\\Leftrightarrow',
  '°': '^\\circ',
  '′': '^{\\prime}',
  '½': '\\frac{1}{2}',
  '⅓': '\\frac{1}{3}',
  '⅔': '\\frac{2}{3}',
  '¼': '\\frac{1}{4}',
  '¾': '\\frac{3}{4}'
}

const EXTRA_COMMANDS = ['\\sin', '\\cos', '\\tan', '\\log', '\\ln', '\\lim', '\\max', '\\min']

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 只在这些已知命令后面补空格：\alphax → \alpha x，但不会把 \alpha 拆成 \alph a。
// 长命令排前面，避免 \subseteq 被 \subset 抢先匹配。
const COMMAND_SPACE_RE = (() => {
  const commands = new Set(EXTRA_COMMANDS)
  for (const latex of Object.values(UNICODE_MATH)) {
    const match = /^\\[a-zA-Z]+/.exec(latex)
    if (match) commands.add(match[0])
  }
  const pattern = [...commands]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|')
  return new RegExp(`(${pattern})(?=[a-zA-Z])`, 'g')
})()

/** 修复单个公式块内容 */
function fixMathContent(content) {
  let c = content
  // HTML 里常把 < > 写成实体；KaTeX 不认识实体，先还原
  c = c.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  // 根号优先处理括号；数字只吃到数字，避免把 √2x 误当成 √(2x)
  c = c.replace(/√\(([^()]*)\)/g, '\\sqrt{$1}')
  c = c.replace(/√(-?\d+(?:\.\d+)?)/g, '\\sqrt{$1}')
  c = c.replace(/√([a-zA-Z]+)/g, '\\sqrt{$1}')
  // 再替换其余 Unicode 数学符号
  for (const [ch, latex] of Object.entries(UNICODE_MATH)) {
    if (c.includes(ch)) c = c.split(ch).join(latex)
  }
  // LaTeX 控制词由连续字母组成：\angleA 会被当成未定义命令 \angleA。
  // 符号替换后若命令紧跟字母，补一个空格（\angle A、\alpha x、\in A）。
  c = c.replace(COMMAND_SPACE_RE, '$1 ')
  return c
}

/**
 * 扫描 HTML 中的公式区间。
 * 允许行内公式里出现 `<`（x<0、a<b），但排除跨过 HTML 标签的 `$...$`，
 * 避免把「价格 $5</p><p>另付 $10」误当成一段公式。
 * @param {string} html
 * @returns {{ start: number, end: number, content: string, display: boolean }[]}
 */
export function scanMath(html) {
  const src = String(html || '')
  const spans = []
  let i = 0
  while (i < src.length) {
    const start = src.indexOf('$', i)
    if (start < 0) break
    // \$ 是转义美元，不是定界符
    if (start > 0 && src[start - 1] === '\\') {
      i = start + 1
      continue
    }
    if (src[start + 1] === '$') {
      const end = src.indexOf('$$', start + 2)
      if (end < 0) {
        i = start + 2
        continue
      }
      spans.push({ start, end: end + 2, content: src.slice(start + 2, end), display: true })
      i = end + 2
      continue
    }
    let j = start + 1
    while (j < src.length && src[j] !== '$' && src[j] !== '\n') j++
    if (j >= src.length || src[j] !== '$' || j === start + 1) {
      i = start + 1
      continue
    }
    const inner = src.slice(start + 1, j)
    if (/<[a-zA-Z/][^>]*>/.test(inner)) {
      i = start + 1
      continue
    }
    spans.push({ start, end: j + 1, content: inner, display: false })
    i = j + 1
  }
  return spans
}

/**
 * 对 HTML 做公式规范化（可直接用于编辑器内容做「本地公式修复」）。
 * @param {string} html
 * @returns {{ html: string, changed: boolean }}
 */
export function normalizeAiMathHtml(html) {
  if (!html) return { html, changed: false }
  const source = String(html)
  let out = source

  // 1) \(...\) / \[...\] → $...$ / $$...$$
  //    内层用 [\s\S]*? 而非 [^()]*?：公式里带括号极常见（如 \((x-2)(x+1)=0\)），
  //    排除括号会让这类公式整段匹配不上，原样残留在正文里渲染不出公式。
  out = out.replace(/\\\[([\s\S]*?)\\\]/g, (_, inner) => `$$${inner.trim()}$$`)
  out = out.replace(/\\\(([\s\S]*?)\\\)/g, (_, inner) => `$${inner.trim()}$`)

  // 2) 从后往前替换每个公式块，避免前面的替换让后面的区间错位
  const spans = scanMath(out)
  for (let k = spans.length - 1; k >= 0; k--) {
    const span = spans[k]
    const inner = span.display
      ? span.content.replace(/\$/g, '').replace(/\s+/g, ' ')
      : span.content
    const fixed = fixMathContent(inner).trim()
    if (!fixed) continue
    const delimiter = span.display ? '$$' : '$'
    out = out.slice(0, span.start) + delimiter + fixed + delimiter + out.slice(span.end)
  }

  return { html: out, changed: out !== source }
}

/**
 * 抽出所有公式片段（供校验与人工复核）。
 * @param {string} html
 * @returns {{ content: string, display: boolean }[]}
 */
export function extractMath(html) {
  return scanMath(html).map((span) => ({
    content: span.content.trim(),
    display: span.display
  }))
}
