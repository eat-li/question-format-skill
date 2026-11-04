// 富文本 ↔ 纯文本，以及 AI 输出的 HTML 清洗。
//
// 这些函数不依赖网络与数据库，但决定「输出是否可用」：去代码围栏、去文档外壳、
// 统一定界符。独立成模块是为了可逐条单测（见 test/clean.test.mjs）。

/** 富文本 → 纯文本：去标签、还原常用实体、压缩空白 */
export function plainText(html) {
  return String(html || '')
    // 只吃真正的标签，避免把公式里的 <（x<0、a<b）当成标签起点
    .replace(/<!--[\s\S]*?-->|<\/?[a-zA-Z][\w-]*(?:\s[^>]*)?\/?>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

const BLOCK_TAG_RE = /<(?:p|div|li|h[1-6]|table|ul|ol|blockquote)[\s>]/i

// 只清理高度确定的客套话，避免误删真正的题干行
const META_LINE_RES = [
  /^[ \t]*(?:以下是|下面是|这是)[^\n]{0,40}(?:整理|排版)[^\n]{0,20}[：:][ \t]*$/gm,
  /^[ \t]*(?:希望|以上)[^\n]{0,40}(?:帮助|有用|参考)[。.!！?？]?[ \t]*$/gm,
  /^[ \t]*以上是[^\n]{0,40}(?:内容|题目|结果)[。.!！?？]?[ \t]*$/gm,
  /^[ \t]*如需[^\n]{0,40}(?:告知|调整|修改)[。.!！?？]?[ \t]*$/gm
]

/**
 * 清洗模型返回的 HTML：去代码围栏与文档壳、归一化公式定界符、压缩空行。
 * @param {string} html
 * @returns {string}
 */
export function cleanAiHtml(html) {
  let out = String(html || '').trim()
    // 围栏可能出现在首尾，也可能被前后语包着，按行删比锚定首尾可靠
    .replace(/^[ \t]*(?:```|~~~)[^\n]*$/gm, '')
    .replace(/<\/?(?:html|body|head)[^>]*>/gi, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')

  // 只有输出确实是 HTML 片段时才清客套话；纯文本结果保持原样，交给调用方判断
  if (BLOCK_TAG_RE.test(out)) {
    for (const re of META_LINE_RES) out = out.replace(re, '')
  }

  // 模型可能用 \(...\) / \[...\] 而非 $...$ / $$...$$，统一转成 KaTeX 约定。
  // 内层必须用 [\s\S]*? 而不是 [^()]*?：数学公式里带括号极其常见
  // （如 \((x-2)(x+1)=0\)），排除括号会导致这类公式整段匹配不上、原样留在正文里。
  out = out.replace(/\\\[([\s\S]*?)\\\]/g, (_, inner) => `$$${inner.trim()}$$`)
  out = out.replace(/\\\(([\s\S]*?)\\\)/g, (_, inner) => `$${inner.trim()}$`)
  out = out.replace(/\n{3,}/g, '\n\n').trim()
  return out
}

const VOID_TAGS = new Set(['br', 'img', 'hr', 'input', 'meta', 'link', 'source', 'col'])

/**
 * 补齐未闭合标签。截断很可能切在段落中间，留下半个标签，
 * 让返回的 HTML 结构完整（模型输出通常是扁平的 p / strong / br，简单栈配平足够）。
 */
export function balanceTags(html) {
  const open = []
  const re = /<(\/?)([a-zA-Z][\w-]*)(?:\s[^>]*)?>/g
  let m
  while ((m = re.exec(html))) {
    const name = m[2].toLowerCase()
    if (VOID_TAGS.has(name)) continue
    if (m[1] === '/') {
      const i = open.lastIndexOf(name)
      if (i >= 0) open.splice(i, 1)
    } else {
      open.push(name)
    }
  }
  return html + open.reverse().map((n) => `</${n}>`).join('')
}
