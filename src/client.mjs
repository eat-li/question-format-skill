// 上游调用层：一切「怎么调模型」的逻辑都在这里，不含任何排版规则。
// 只依赖 Node 18+ 内置 fetch，无第三方运行时依赖。

export const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1'
export const DEFAULT_MODEL = 'deepseek-chat'
export const DEFAULT_TIMEOUT_MS = 120_000

/** 规整接口地址：去尾斜杠、校验协议 */
export function normalizeBaseUrl(raw) {
  const input = String(raw || '').trim().replace(/\/+$/, '')
  if (!input) return ''
  try {
    const url = new URL(input)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

/** 从参数或环境变量解析调用配置；缺 Key 时返回 error 而非抛错 */
export function resolveTarget({ apiKey, baseUrl, model } = {}) {
  const key = String(apiKey || process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '').trim()
  if (!key) {
    return { error: '缺少 API Key：请设置环境变量 AI_API_KEY，或传 --api-key' }
  }
  const base = normalizeBaseUrl(baseUrl || process.env.AI_BASE_URL || DEFAULT_BASE_URL)
  if (!base) {
    return { error: `接口地址无效：${baseUrl || process.env.AI_BASE_URL || DEFAULT_BASE_URL}` }
  }
  const resolvedModel = String(model || process.env.AI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL
  return { key, base, model: resolvedModel }
}

/**
 * 调用 OpenAI 兼容 /chat/completions，返回助手文本。
 * @returns {Promise<string>}
 */
export async function callChat({
  key,
  base,
  model,
  messages,
  temperature = 0.2,
  maxTokens = 4096,
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let resp
    try {
      resp = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
        signal: controller.signal
      })
    } catch (e) {
      const err = new Error(
        controller.signal.aborted
          ? `请求超时（${timeoutMs}ms）：可调大 --timeout，或换 --model`
          : `网络请求失败：${e.message}`
      )
      err.code = controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR'
      throw err
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      let msg = `上游返回 HTTP ${resp.status}`
      try {
        const j = JSON.parse(errText)
        if (j?.error?.message) msg = j.error.message
      } catch {
        if (errText) msg = errText.slice(0, 300)
      }
      const err = new Error(msg)
      err.httpStatus = resp.status
      throw err
    }

    let data
    try {
      data = await resp.json()
    } catch {
      const err = new Error(
        controller.signal.aborted
          ? `请求超时（${timeoutMs}ms）：可调大 --timeout，或换 --model`
          : '上游返回的不是合法 JSON'
      )
      err.code = controller.signal.aborted ? 'TIMEOUT' : 'BAD_RESPONSE'
      throw err
    }
    return String(data?.choices?.[0]?.message?.content || '')
  } finally {
    clearTimeout(timer)
  }
}
