// 提示词加载：references/prompt.md 是基础提示词，代码不复制它的内容。
// 字段规则由 buildSystemPrompt 追加，改基础提示词不必改代码，也不会出现「文档写一套、实际发另一套」。
import { readFileSync } from 'node:fs'

const PROMPT_URL = new URL('../references/prompt.md', import.meta.url)

let cached = ''

/** 读取系统提示词（纯文本，已 trim） */
export function loadSystemPrompt() {
  if (!cached) cached = readFileSync(PROMPT_URL, 'utf8').trim()
  return cached
}

/**
 * 在基础提示词后追加本次字段规则。
 * 模型不知道 field，只靠后处理截断会让「题干」更容易补答案；提前告知能减少一次重试。
 */
export function buildSystemPrompt(field = 'auto') {
  const base = loadSystemPrompt()
  if (field === 'answer') {
    return `${base}\n\n本次字段是「答案与解析」：原文里的答案与解析要保留，并按格式规范化。`
  }
  if (field === 'body') {
    return `${base}\n\n本次字段是「补充说明」：原文没有的答案、解析、结论、评注绝对不要输出。`
  }
  return `${base}\n\n本次字段是「题干」：原文没有的答案、解析、结论、评注绝对不要输出。`
}

export { PROMPT_URL }
