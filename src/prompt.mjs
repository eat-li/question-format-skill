// 提示词加载：references/prompt.md 是唯一事实来源，代码不复制一份。
// 这样改提示词不必改代码，SKILL.md 里写的规则与 CLI 实际发送的内容也不会漂移。
import { readFileSync } from 'node:fs'

const PROMPT_URL = new URL('../references/prompt.md', import.meta.url)

let cached = ''

/** 读取系统提示词（纯文本，已 trim） */
export function loadSystemPrompt() {
  if (!cached) cached = readFileSync(PROMPT_URL, 'utf8').trim()
  return cached
}

export { PROMPT_URL }
