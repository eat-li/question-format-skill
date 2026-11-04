// 离线守卫：把「能靠规则验证的」都验证一遍，供 Agent 直接排版（路径 A）后自检。
//
// 顺序与 formatQuestion 一致：清洗 → 防泄题截断 → 标签配平 → 公式归一 → 守恒校验。
// 这里只报告问题，不做语义改写；不可修复的问题（多数字、少数字、裸文本等）由调用方决定。
import { balanceTags, cleanAiHtml, plainText } from './clean.mjs'
import { normalizeAiMathHtml, scanMath, UNICODE_MATH } from './normalize-math.mjs'
import { stripUnrequestedAnswerDetailed } from './strip-answer.mjs'
import { sanitizeHtml } from './sanitize.mjs'

const VOID_TAGS = new Set(['br', 'img', 'hr', 'input', 'meta', 'link', 'source', 'col'])

const SUPERSCRIPT = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9'
}
const SUBSCRIPT = {
  '₀': '0',
  '₁': '1',
  '₂': '2',
  '₃': '3',
  '₄': '4',
  '₅': '5',
  '₆': '6',
  '₇': '7',
  '₈': '8',
  '₉': '9'
}
const FRACTIONS = { '½': '1 2', '⅓': '1 3', '⅔': '2 3', '¼': '1 4', '¾': '3 4' }

const UNICODE_MATH_RE = new RegExp(`[${Object.keys(UNICODE_MATH).join('')}√]`)

function normalizeNumericChars(text) {
  return String(text || '')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (ch) => SUPERSCRIPT[ch])
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (ch) => SUBSCRIPT[ch])
    .replace(/[½⅓⅔¼¾]/g, (ch) => FRACTIONS[ch])
}

/** 收集数字集合，用于「原文有的数字不能少、原文没有的数字不能多」 */
export function collectNumbers(text) {
  const set = new Set()
  // 图片 alt 里的题号/图号也算正文数字，避免「图1」被误判为丢失
  const withAlt = String(text || '').replace(
    /<img\b[^>]*?\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi,
    (_, a, b, c) => ` ${a || b || c} `
  )
  const normalized = normalizeNumericChars(plainText(withAlt))
  for (const match of normalized.matchAll(/\d+(?:\.\d+)?/g)) set.add(match[0])
  return set
}

/** 收集选项字母；富文本按 <p>A. …</p> 形态取，纯文本按 A. / (A) 形态取 */
export function collectOptions(text, isHtml = false) {
  const set = new Set()
  const src = String(text || '')
  const re = isHtml
    ? /<(?:p|li|div)[^>]*>\s*(?:<[^>]+>\s*)*[（(]?\s*([A-H])\s*[.、．)）]/gi
    : /(?:^|[\s，。；;：:（(])(?:([A-H])\s*[.、．)）]|[（(]([A-H])[）)])/g
  for (const match of src.matchAll(re)) {
    const letter = (match[1] || match[2] || '').toUpperCase()
    if (letter) set.add(letter)
  }
  return set
}

/** 取出所有位于任何标签之外的文本（块级标签内的正文不算） */
function textOutsideTags(html) {
  const src = String(html || '').replace(/<!--[\s\S]*?-->/g, '')
  const re = /<\/?([a-zA-Z][\w-]*)(?:\s[^>]*)?>/g
  let depth = 0
  let last = 0
  let out = ''
  let match
  while ((match = re.exec(src))) {
    if (depth === 0) out += src.slice(last, match.index)
    const name = match[1].toLowerCase()
    if (!VOID_TAGS.has(name)) {
      if (match[0][1] === '/') depth = Math.max(0, depth - 1)
      else depth++
    }
    last = re.lastIndex
  }
  if (depth === 0) out += src.slice(last)
  return out
}

/** 从字符串里删掉所有公式区间，剩下的是正文 */
function removeMath(text) {
  const src = String(text || '')
  const spans = scanMath(src)
  let out = src
  for (let i = spans.length - 1; i >= 0; i--) {
    out = out.slice(0, spans[i].start) + out.slice(spans[i].end)
  }
  return out
}

/**
 * 对一份已经排好的 HTML 做离线守卫。
 * @param {object} opts
 * @param {string} opts.sourceText 用户原文
 * @param {string} opts.html 待检查的 HTML
 * @param {'stem'|'body'|'answer'|'auto'} [opts.field]
 * @param {boolean} [opts.sanitize] 是否顺手做白名单消毒
 * @returns {{
 *   html: string,
 *   field: string,
 *   fixes: string[],
 *   errors: { code: string, message: string }[],
 *   removedAnswer: boolean,
 *   changed: boolean,
 *   ok: boolean
 * }}
 */
export function guardHtml({ sourceText, html, field = 'auto', sanitize = false } = {}) {
  const original = String(html || '')
  const fixes = []
  const errors = []
  const addError = (code, message) => errors.push({ code, message })

  let out = cleanAiHtml(original)
  if (out !== original.trim()) fixes.push('CLEANED_OUTPUT')

  const stripped = stripUnrequestedAnswerDetailed(sourceText, out, field)
  out = stripped.html
  if (stripped.removed) fixes.push('REMOVED_UNREQUESTED_ANSWER')
  if (stripped.removed && !out) {
    addError('ALL_ANSWERS_DROPPED', '输出全部是原文没有的答案解析，已丢弃')
    return {
      html: '',
      field,
      fixes,
      errors,
      removedAnswer: true,
      changed: true,
      ok: false
    }
  }

  const balanced = balanceTags(out)
  if (balanced !== out) {
    fixes.push('BALANCED_TAGS')
    out = balanced
  }

  const normalized = normalizeAiMathHtml(out)
  if (normalized.changed) fixes.push('NORMALIZED_MATH')
  out = normalized.html

  if (sanitize) {
    const safe = sanitizeHtml(out)
    if (safe !== out) fixes.push('SANITIZED')
    out = safe
  }

  if (!out.trim()) {
    addError('EMPTY_RESULT', '输出为空')
  } else {
    const outside = plainText(removeMath(textOutsideTags(out))).trim()
    if (outside) addError('TEXT_OUTSIDE_TAGS', `标签外有文本：${outside.slice(0, 40)}`)

    const leftover = removeMath(out).replace(/\\\$/g, '')
    if (leftover.includes('$')) {
      addError('BARE_DOLLAR', '正文里有未配对的 $（价格请写成 \\$ 或「美元」）')
    }

    const spans = scanMath(out)
    const residues = [...spans.map((span) => span.content), plainText(removeMath(out))]
    const residue = residues.find((content) => UNICODE_MATH_RE.test(content))
    if (residue) {
      addError('UNICODE_MATH_LEFT', `还有 Unicode 数学符号：${residue.trim().slice(0, 40)}`)
    }

    const srcNumbers = collectNumbers(sourceText)
    const outNumbers = collectNumbers(out)
    for (const number of outNumbers) {
      if (!srcNumbers.has(number)) addError('ADDED_NUMBER', `输出出现原文没有的数字 ${number}`)
    }
    for (const number of srcNumbers) {
      if (!outNumbers.has(number)) addError('LOST_NUMBER', `原文的数字 ${number} 在输出中消失`)
    }

    const srcOptions = collectOptions(plainText(sourceText), false)
    const outOptions = collectOptions(out, true)
    const addedOptions = [...outOptions].filter((letter) => !srcOptions.has(letter))
    if (addedOptions.length) {
      addError('ADDED_OPTION', `输出出现原文没有的选项 ${addedOptions.join('、')}`)
    }
    const lostOptions = [...srcOptions].filter((letter) => !outOptions.has(letter))
    if (lostOptions.length) {
      addError('LOST_OPTION', `原文的选项 ${lostOptions.join('、')} 在输出中消失`)
    }

    if (/<\s*(?:script|style|iframe|object|embed|form|link|meta)\b/i.test(out)) {
      addError('DANGEROUS_TAG', '输出包含 script/style/iframe 等不允许的标签')
    }
    if (/\son[a-z]+\s*=/i.test(out)) addError('DANGEROUS_ATTR', '输出包含 on* 事件属性')
    if (/(?:href|src)\s*=\s*["']?\s*javascript:/i.test(out)) {
      addError('DANGEROUS_URL', '输出包含 javascript: 链接')
    }
    if (/\sstyle\s*=/i.test(out)) addError('INLINE_STYLE', '输出包含内联 style，落库后会被剥掉')
  }

  return {
    html: out,
    field,
    fixes,
    errors,
    removedAnswer: stripped.removed,
    changed: out !== original,
    ok: errors.length === 0
  }
}
