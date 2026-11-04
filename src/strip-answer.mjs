// 防泄题兜底：删掉模型凭空补出的「答案 / 解析」。
//
// 提示词写得再严，模型偶尔仍会在题干里补一段答案。题干会直接展示给学生，
// 所以这里做一道确定性兜底，而不是只靠模型自觉。设计说明见 references/answer-leak.md。
import { plainText, balanceTags } from './clean.mjs'

/**
 * 原文确实带了答案：冒号 / 是 / 为 / 【】形式。
 * 不能用「包含答案或解析」——数学题干里的「解析式」「解析几何」会让兜底整体失效。
 */
export const ANSWER_HINT_RE =
  /【\s*(?:参考|正确)?(?:答案|解析|解答)\s*】|(?:参考|正确)?(?:答案|解析|解答)\s*[：:]|(?:参考|正确)?(?:答案|解析|解答)\s*(?:是|为)/

/** 原文里单独一行的「答案 / 解析 / 解答」也算带了答案 */
function hasBareAnswerLine(text) {
  return /(?:^|[\n\r])\s*(?:参考|正确)?(?:答案|解析|解答)\s*(?=[\n\r]|$)/.test(String(text || ''))
}

/**
 * 「整段就是答案」：答案标记必须出现在这一段开头。
 * 不能用「包含」——否则「…求 f(2) 的值。答案：5」这种把答案跟在正文后的段落会被整段误删。
 */
export const ANSWER_HEAD_RE =
  /^\s*(?:【\s*(?:参考|正确)?(?:答案|解析|解答)\s*】|(?:(?:故|所以|因此|综上|最终|正确)\s*)?(?:参考|正确)?(?:答案|解析|解答)(?:\s*[：:]|\s*(?:是|为)\s*|\s*选\s*(?:[：:]|[A-H])|\s+(?=\S)|\s*$)|解\s*[：:]|(?:故|所以|因此|综上)?\s*(?:故选|应选|所以选|因此选|故选择)\s*(?:[：:]|(?=[A-H])|\s*$))/

/**
 * 行内答案标记：句末标点、逗号或换行之后紧跟「答案：」「故答案为」「故选」。
 * 第一组捕获前置标点本身，句末标点截断时留在原地，否则会把正文的句号一起切掉。
 */
export const ANSWER_INLINE_RE =
  /((?:[。；;！？!?，,]\s*|<br\s*\/?>\s*))(?:(?:<[^>]+>\s*)*(?:【\s*)?(?:(?:故|所以|因此|综上|最终|正确)\s*)?(?:参考|正确)?(?:答案|解析|解答)(?:\s*】)?\s*(?:[：:]|是|为|选(?=\s*[A-H：:])|\s*<\/[a-zA-Z][^>]*>\s*(?=\S))|(?:故|所以|因此|综上)?\s*(?:故选|应选|所以选|因此选|故选择)(?:\s*<\/?[a-zA-Z][^>]*>\s*)*(?:[：:]|(?=[A-H])))/

/**
 * 去掉模型凭空补出的答案解析，并报告是否发生截断。
 * @param {string} sourceText 用户给的原文（纯文本或富文本都可）
 * @param {string} html 模型返回的 HTML
 * @param {'stem'|'body'|'answer'|'auto'} [field] 字段身份；answer 表示这段本来就是答案
 * @returns {{ html: string, removed: boolean }} html 为空串表示「整份结果都是多余的答案」
 */
export function stripUnrequestedAnswerDetailed(sourceText, html, field) {
  if (String(field || '') === 'answer') return { html, removed: false }
  if (!html) return { html, removed: false }

  const source = String(sourceText || '')
  const sourceTextPlain = plainText(source)
  // 原文自带答案 → 交给模型按格式规范化，不删
  if (
    ANSWER_HINT_RE.test(sourceTextPlain) ||
    hasBareAnswerLine(source) ||
    /^(?:参考|正确)?(?:答案|解析|解答)\s*$/.test(sourceTextPlain)
  ) {
    return { html, removed: false }
  }

  // 原文完全没有「答案 / 解析」字样，因此输出里出现的任何一处都是模型自己加的。
  // 先按块级标签切开，从第一段「以答案标记开头」的段落起整体截掉。
  const blocks = html.split(/(?<=<\/(?:p|div|li|h[1-6]|blockquote|td|tr)>)/i)
  let cut = blocks.length
  for (let i = 0; i < blocks.length; i++) {
    if (ANSWER_HEAD_RE.test(plainText(blocks[i]))) {
      cut = i
      break
    }
  }

  let kept = cut < blocks.length ? blocks.slice(0, cut).join('') : html
  let removed = cut < blocks.length

  // 答案跟在正文同一段里（如「…求 f(2) 的值。答案：5」）时，从标记处截断。
  // 句末标点保留，逗号丢弃——避免在题干末尾留下一个孤零零的逗号。
  const inline = ANSWER_INLINE_RE.exec(kept)
  if (inline) {
    const punct = inline[1].trim()
    const keepPunct = /^[。；;！？!?]/.test(punct) || /^<br/i.test(punct)
    kept = kept.slice(0, inline.index + (keepPunct ? inline[1].length : 0))
    removed = true
  }

  kept = kept.trim()
  const out = kept ? balanceTags(kept) : ''
  return { html: out, removed }
}

/**
 * 去掉模型凭空补出的答案解析。
 * @param {string} sourceText 用户给的原文（纯文本或富文本都可）
 * @param {string} html 模型返回的 HTML
 * @param {'stem'|'body'|'answer'|'auto'} [field] 字段身份；answer 表示这段本来就是答案
 * @returns {string} 返回空串表示「整份结果都是多余的答案」，调用方应报错而非静默写入
 */
export function stripUnrequestedAnswer(sourceText, html, field) {
  return stripUnrequestedAnswerDetailed(sourceText, html, field).html
}
