// 排版结果缓存：同一段文本 + 字段 + 模型 + 提示词命中时不再调用上游。
//
// 缓存只是省钱手段，命中失败（目录不可写、文件损坏）时静默降级为正常调用。
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSystemPrompt } from './prompt.mjs'

/** 缓存键包含所有会影响模型输出的参数；提示词改一个字也会失效 */
export function formatCacheKey({ text, field, base, model, temperature, maxTokens }) {
  const payload = JSON.stringify({
    v: 1,
    text: String(text || ''),
    field: field || 'auto',
    base: base || '',
    model: model || '',
    temperature,
    maxTokens,
    prompt: buildSystemPrompt(field || 'auto')
  })
  return createHash('sha256').update(payload).digest('hex')
}

/** 断点续跑用：只比 id 不够，文本改了也应该重跑 */
export function inputHash({ text, field }) {
  return createHash('sha256')
    .update(`${field || 'auto'}\n${String(text || '')}`)
    .digest('hex')
    .slice(0, 16)
}

/**
 * @returns {{ html: string, changed: boolean, removedAnswer: boolean, createdAt?: string } | null}
 */
export function readCache(dir, key) {
  try {
    const file = join(dir, `${key}.json`)
    if (!existsSync(file)) return null
    const data = JSON.parse(readFileSync(file, 'utf8'))
    if (!data || typeof data.html !== 'string' || !data.html) return null
    return data
  } catch {
    return null
  }
}

export function writeCache(dir, key, value) {
  try {
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${key}.json`)
    writeFileSync(
      file,
      JSON.stringify({
        html: value.html,
        changed: Boolean(value.changed),
        removedAnswer: Boolean(value.removedAnswer),
        createdAt: new Date().toISOString()
      })
    )
  } catch {
    // 缓存写失败不影响排版结果
  }
}
