// 对外主入口：一次调用完成「排版 → 清洗 → 防泄题 → 公式规范化」。
import { cleanAiHtml } from './clean.mjs'
import { stripUnrequestedAnswerDetailed } from './strip-answer.mjs'
import { normalizeAiMathHtml } from './normalize-math.mjs'
import { loadSystemPrompt } from './prompt.mjs'
import { callChat, resolveTarget } from './client.mjs'

export { plainText, cleanAiHtml, balanceTags } from './clean.mjs'
export { stripUnrequestedAnswer, stripUnrequestedAnswerDetailed } from './strip-answer.mjs'
export { normalizeAiMathHtml, extractMath, scanMath, UNICODE_MATH } from './normalize-math.mjs'
export { guardHtml, collectNumbers, collectOptions } from './guard.mjs'
export { validateAiMath } from './validate-math.mjs'
export { callChat, resolveTarget, DEFAULT_BASE_URL, DEFAULT_MODEL } from './client.mjs'
export { loadSystemPrompt } from './prompt.mjs'

/**
 * 纯函数后处理：清洗 → 防泄题截断 → 公式规范化。
 * 顺序与生产环境一致：先删掉不该出现的答案解析，再修公式——
 * 反过来会让截断逻辑面对一堆已经改过的符号，判定更不可预测。
 *
 * @param {string} raw 模型原始输出
 * @param {string} sourceText 用户原文
 * @param {'stem'|'body'|'answer'|'auto'} field
 */
export function postProcess(raw, sourceText, field = 'auto') {
  const cleaned = cleanAiHtml(raw)
  if (!cleaned) return { html: '', dropped: false, changed: false, removedAnswer: false }
  const stripped = stripUnrequestedAnswerDetailed(sourceText, cleaned, field)
  if (!stripped.html) {
    return { html: '', dropped: true, changed: false, removedAnswer: stripped.removed }
  }
  const { html, changed } = normalizeAiMathHtml(stripped.html)
  return { html, dropped: false, changed, removedAnswer: stripped.removed }
}

/**
 * AI 排版一道题。
 * @param {object} opts
 * @param {string} opts.text 待排版的内容（纯文本或已有 HTML）
 * @param {'stem'|'body'|'answer'|'auto'} [opts.field] 字段身份，决定要不要删掉多出来的答案解析
 * @param {string} [opts.apiKey]
 * @param {string} [opts.baseUrl]
 * @param {string} [opts.model]
 * @param {number} [opts.temperature]
 * @param {number} [opts.timeoutMs]
 * @param {Function} [opts.call] 注入的调用函数（测试用）
 * @returns {Promise<{ html: string, dropped: boolean, changed: boolean, removedAnswer: boolean }>}
 */
export async function formatQuestion({
  text,
  field = 'auto',
  apiKey,
  baseUrl,
  model,
  temperature = 0.2,
  timeoutMs,
  call = callChat
} = {}) {
  if (!text || !String(text).trim()) {
    const err = new Error('没有可排版的内容')
    err.code = 'EMPTY_INPUT'
    throw err
  }

  const target = resolveTarget({ apiKey, baseUrl, model })
  if (target.error) {
    const err = new Error(target.error)
    err.code = 'NO_API_KEY'
    throw err
  }

  const raw = await call({
    ...target,
    temperature,
    timeoutMs,
    messages: [
      { role: 'system', content: loadSystemPrompt() },
      { role: 'user', content: String(text) }
    ]
  })

  const result = postProcess(raw, String(text), field)
  if (result.dropped) {
    const err = new Error(
      '模型返回的内容全是原文里没有的答案解析，已全部丢弃；请重试，或改用本地公式修复'
    )
    err.code = 'ALL_ANSWERS_DROPPED'
    throw err
  }
  if (!result.html) {
    const err = new Error('模型未返回可用内容')
    err.code = 'EMPTY_RESULT'
    throw err
  }
  return result
}
