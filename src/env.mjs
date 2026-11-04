// 极简 .env 读取（仅 KEY=VALUE，支持 # 注释与包裹引号）。
// 不引第三方 dotenv：这个 skill 的卖点之一是零运行时依赖。
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** 读取并注入 process.env（不覆盖已存在的变量） */
export function loadDotEnv(cwd = process.cwd()) {
  const file = resolve(cwd, '.env')
  if (!existsSync(file)) return
  const text = readFileSync(file, 'utf8')
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}
