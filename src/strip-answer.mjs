// 防泄题兜底：删掉模型凭空补出的「答案 / 解析」。
//
// 提示词写得再严，模型偶尔仍会在题干里补一段答案。题干会直接展示给学生，
// 所以这里做一道确定性兜底，而不是只靠模型自觉。设计说明见 references/answer-leak.md。
import { plainText, balanceTags } from './clean.mjs'

/** 原文出现这些字样，说明排版本来的就是答案内容（或在题干里提到了答案），不删 */
export const ANSWER_HINT_RE = /答案|解析|参考解答|参考答案/

/**
 * 「整段就是答案」：答案标记必须出现在这一段开头。
 * 不能用「包含」——否则「…求 f(2) 的值。答案：5」这种把答案跟在正文后的段落会被整段误删。
 */
export const ANSWER_HEAD_RE =
  /^\s*(?:【\s*(?:参考)?(?:答案|解析|解答)\s*】|(?:参考)?(?:答案|解析)(?:\s*[：:]|\s*$)|解\s*[：:])/

/**
 * 行内答案标记：句末标点或换行之后紧跟「答案：」「解析：」。
 * 第一组捕获句末标点本身，截断时留在原地，否则会把正文的句号一起切掉。
 */
export const ANSWER_INLINE_RE =
  /((?:[。；;！？!?]|<br\s*\/?>)\s*)(?:(?:<[^>]+>\s*)*(?:【\s*)?(?:参考)?(?:答案|解析)(?:\s*】)?\s*[：:])/

/**
 * 去掉模型凭空补出的答案解析。
 * @param {string} sourceText 用户给的原文（纯文本或富文本都可）
 * @param {string} html 模型返回的 HTML
 * @param {'stem'|'body'|'answer'|'auto'} [field] 字段身份；answer 表示这段本来就是答案
 * @returns {string} 返回空串表示「整份结果都是多余的答案」，调用方应报错而非静默写入
 */
export function stripUnrequestedAnswer(sourceText, html, field) {
  if (String(field || '') === 'answer') return html
  if (!html) return html
  // 原文自带答案 → 交给模型按格式规范化，不删
  if (ANSWER_HINT_RE.test(plainText(sourceText))) return html

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

  // 答案跟在正文同一段里（如「…求 f(2) 的值。答案：5」）时，从标记处截断，句末标点保留
  const inline = ANSWER_INLINE_RE.exec(kept)
  if (inline) kept = kept.slice(0, inline.index + inline[1].length)

  kept = kept.trim()
  return kept ? balanceTags(kept) : ''
}
