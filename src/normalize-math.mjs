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
  '∑': '\\sum',
  '∏': '\\prod',
  '∞': '\\infty',
  '∫': '\\int',
  '≥': '\\ge',
  '≤': '\\le',
  '≠': '\\ne',
  '≈': '\\approx',
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
  '∠': '\\angle',
  '⊥': '\\perp',
  '∥': '\\parallel',
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
  '½': '\\frac{1}{2}',
  '⅓': '\\frac{1}{3}',
  '⅔': '\\frac{2}{3}',
  '¼': '\\frac{1}{4}',
  '¾': '\\frac{3}{4}'
}

/** 修复单个公式块内容 */
function fixMathContent(content) {
  let c = content
  // 先处理带操作数的根号：√(…) 与 √x
  c = c.replace(/√\(([^()]*)\)/g, '\\sqrt{$1}')
  c = c.replace(/√([a-zA-Z0-9]+)/g, '\\sqrt{$1}')
  // 再替换其余 Unicode 数学符号
  for (const [ch, latex] of Object.entries(UNICODE_MATH)) {
    if (c.includes(ch)) c = c.split(ch).join(latex)
  }
  return c
}

/**
 * 对 HTML 做公式规范化（可直接用于编辑器内容做「本地公式修复」）。
 * @param {string} html
 * @returns {{ html: string, changed: boolean }}
 */
export function normalizeAiMathHtml(html) {
  if (!html) return { html, changed: false }
  let out = html

  // 1) \(...\) / \[...\] → $...$ / $$...$$
  //    内层用 [\s\S]*? 而非 [^()]*?：公式里带括号极常见（如 \((x-2)(x+1)=0\)），
  //    排除括号会让这类公式整段匹配不上，原样残留在正文里渲染不出公式。
  out = out.replace(/\\\[([\s\S]*?)\\\]/g, (_, inner) => `$$${inner.trim()}$$`)
  out = out.replace(/\\\(([\s\S]*?)\\\)/g, (_, inner) => `$${inner.trim()}$`)

  // 2) 处理 $$...$$ 块（可跨 <br>）：去多余 $、替换 Unicode、压缩空白
  out = out.replace(/\$\$([\s\S]*?)\$\$/g, (raw, inner) => {
    const fixed = fixMathContent(inner.replace(/\$/g, '').replace(/\s+/g, ' ')).trim()
    return fixed ? `$$${fixed}$$` : raw
  })

  // 3) 处理行内 $...$：替换 Unicode（不跨标签/换行）
  out = out.replace(/\$([^$\n<]+?)\$/g, (raw, inner) => {
    const fixed = fixMathContent(inner).trim()
    return fixed ? `$${fixed}$` : raw
  })

  return { html: out, changed: out !== html }
}

/**
 * 抽出所有公式片段（供校验与人工复核）。
 * @param {string} html
 * @returns {{ content: string, display: boolean }[]}
 */
export function extractMath(html) {
  const out = []
  String(html || '').replace(/\$\$([\s\S]*?)\$\$|\$([^$\n<]+?)\$/g, (raw, d, i) => {
    out.push({ content: (d ?? i ?? '').trim(), display: Boolean(d) })
    return raw
  })
  return out
}
