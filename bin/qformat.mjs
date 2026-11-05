#!/usr/bin/env node
// qformat —— 题目排版命令行
//
//   qformat format <file|-> [--field stem|body|answer|auto] [--out f.html] [--json]
//   qformat format <batch.json> --batch [--out result.json]
//   qformat repair <file|-> [--out f.html]
//   qformat verify <file|->
//   qformat guard <file|-> --source <原文> [--field stem] [--out f.html] [--json]
//
// 输入为 `-` 时读 stdin。format 需要 AI_API_KEY（.env 或环境变量）。
import { readFileSync, writeFileSync, appendFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDotEnv } from '../src/env.mjs'
import {
  formatQuestion,
  cleanAiHtml,
  normalizeAiMathHtml,
  validateAiMath,
  guardHtml,
  sanitizeHtml,
  formatCacheKey,
  inputHash,
  readCache,
  writeCache,
  resolveTarget,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL
} from '../src/index.mjs'

const HELP = `qformat —— 把一段题目文本整理成规范 HTML（数学公式用 KaTeX）

用法
  qformat format <输入>            调用大模型排版（需要 AI_API_KEY）
  qformat format <输入> --batch    批量：输入为 JSON 数组 [{id,text,field}]
  qformat repair <输入>            本地公式修复：Unicode → LaTeX、定界符归一，不联网
  qformat verify <输入>            KaTeX 逐段校验公式，有失败则退出码 1
  qformat guard <输入>             离线守卫：清洗、防泄题、公式归一、数字/选项守恒校验
  qformat sanitize <输入>          HTML 白名单消毒：去 script / on* / javascript: / 内联 style

输入
  文件路径，或 - 表示从标准输入读取

选项
  --field <stem|body|answer|auto>  字段身份，默认 auto。
                                   stem/body 会删掉模型凭空补出的答案解析；
                                   answer 表示这段内容本身就是答案，原样放行。
  --source <文件>                  guard 专用：用户原文（用于防泄题与守恒比对）
  --source-text <文本>             guard 专用：直接传原文文本
  --sanitize                       guard 专用：检查后顺手做白名单消毒
  --out <文件>                     结果写入文件（默认打印到 stdout）
  --json                           以 JSON 输出（guard 输出 html/fixes/errors）
  --batch                          format 专用：输入按 JSON 数组处理
  --concurrency <n>                批量并发数，默认 3
  --resume                         format --batch 专用：按 id 跳过已成功项，需配合 --out
  --no-cache                       禁用结果缓存（默认启用）
  --cache-dir <目录>               缓存目录，默认 .qformat-cache
  --max-tokens <n>                 单次回复上限，默认 4096
  --api-key <key>                  覆盖 AI_API_KEY
  --base-url <url>                 覆盖 AI_BASE_URL，默认 https://api.deepseek.com/v1
  --model <name>                   覆盖 AI_MODEL，默认 deepseek-chat
  --timeout <ms>                   单次请求超时，默认 120000
  -h, --help                       显示本帮助
  -v, --version                    显示版本

示例
  echo '已知f(x)=x²-2x+3，求f(2)的值。' | qformat format - --field stem
  qformat repair 题库.txt --out 题库.html
  qformat guard 整理后.html --source 原文.txt --field stem --sanitize
  qformat format 题目.json --batch --out 结果.json --concurrency 3 --resume
`

function parseArgs(rawArgv) {
  // 支持 --field=stem 这种紧凑写法
  const argv = rawArgv.flatMap((a) => {
    if (a.startsWith('--') && a.includes('=')) {
      const i = a.indexOf('=')
      return [a.slice(0, i), a.slice(i + 1)]
    }
    return [a]
  })
  const opts = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('-') || a === '-') {
      opts._.push(a)
      continue
    }
    const takeValue = () => {
      const v = argv[++i]
      if (v === undefined) die(`参数 ${a} 缺少取值`)
      return v
    }
    switch (a) {
      case '-h':
      case '--help':
        opts.help = true
        break
      case '-v':
      case '--version':
        opts.version = true
        break
      case '--json':
        opts.json = true
        break
      case '--batch':
        opts.batch = true
        break
      case '--resume':
        opts.resume = true
        break
      case '--no-cache':
        opts.noCache = true
        break
      case '--sanitize':
        opts.sanitize = true
        break
      case '--cache-dir':
        opts.cacheDir = takeValue()
        break
      case '--max-tokens': {
        const raw = takeValue()
        const n = Number(raw)
        if (!Number.isInteger(n) || n <= 0) die(`--max-tokens 需要正整数，收到 ${raw}`)
        opts.maxTokens = n
        break
      }
      case '--field':
        opts.field = takeValue()
        break
      case '--source':
        opts.source = takeValue()
        break
      case '--source-text':
        opts.sourceText = takeValue()
        break
      case '--out':
        opts.out = takeValue()
        break
      case '--api-key':
        opts.apiKey = takeValue()
        break
      case '--base-url':
        opts.baseUrl = takeValue()
        break
      case '--model':
        opts.model = takeValue()
        break
      case '--timeout': {
        const raw = takeValue()
        const n = Number(raw)
        if (!Number.isFinite(n) || n <= 0) die(`--timeout 需要正整数毫秒，收到 ${raw}`)
        opts.timeoutMs = n
        break
      }
      case '--concurrency': {
        const raw = takeValue()
        const n = Number(raw)
        if (!Number.isInteger(n) || n <= 0) die(`--concurrency 需要正整数，收到 ${raw}`)
        opts.concurrency = n
        break
      }
      default:
        die(`未知参数：${a}（用 --help 查看用法）`)
    }
  }
  return opts
}

function die(message, code = 2) {
  process.stderr.write(`qformat: ${message}\n`)
  process.exit(code)
}

function readInput(spec, label = '输入') {
  if (spec === '-' || spec === undefined) {
    if (spec === undefined && process.stdin.isTTY) {
      die(`缺少${label}：请传入文件路径，或用 - 从标准输入读取`)
    }
    try {
      return readFileSync(0, 'utf8')
    } catch {
      die(`无法读取标准输入（${label}）`)
    }
  }
  try {
    return readFileSync(spec, 'utf8')
  } catch (e) {
    die(`无法读取 ${spec}：${e.code === 'ENOENT' ? '文件不存在' : e.message}`)
  }
}

function emit(text, out) {
  if (out) {
    const target = resolve(out)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, text)
    process.stderr.write(`qformat: 已写入 ${out}\n`)
  } else {
    process.stdout.write(text.endsWith('\n') ? text : text + '\n')
  }
}

const VALID_FIELDS = new Set(['stem', 'body', 'answer', 'auto'])

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withRetry(fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      const retriable = e?.httpStatus === 429 || (e?.httpStatus >= 500 && e?.httpStatus < 600)
      if (!retriable || attempt >= 2) throw e
      await sleep(500 * 2 ** attempt)
    }
  }
}

const DEFAULT_CACHE_DIR = '.qformat-cache'
const DEFAULT_MAX_TOKENS = 4096

function cacheDirOf(opts) {
  return resolve(opts.cacheDir || DEFAULT_CACHE_DIR)
}

function cacheKeyFor(opts, field, text) {
  if (opts.noCache) return ''
  const target = resolveTarget({
    apiKey: 'cache',
    baseUrl: opts.baseUrl,
    model: opts.model
  })
  return formatCacheKey({
    text,
    field,
    base: target.base || String(opts.baseUrl || process.env.AI_BASE_URL || DEFAULT_BASE_URL),
    model: target.model || String(opts.model || process.env.AI_MODEL || DEFAULT_MODEL),
    temperature: 0.2,
    maxTokens: opts.maxTokens || DEFAULT_MAX_TOKENS
  })
}

function idKey(id) {
  return JSON.stringify(id)
}

function loadPrevious(outPath, partialPath) {
  const map = new Map()
  const add = (record) => {
    if (record && record.id !== undefined) map.set(idKey(record.id), record)
  }
  if (outPath && existsSync(outPath)) {
    try {
      const rows = JSON.parse(readFileSync(outPath, 'utf8'))
      if (Array.isArray(rows)) rows.forEach(add)
    } catch {
      // 旧的输出文件损坏时忽略，按全新批次处理
    }
  }
  if (partialPath && existsSync(partialPath)) {
    for (const line of readFileSync(partialPath, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        add(JSON.parse(line))
      } catch {
        // 跳过崩溃时写了一半的行
      }
    }
  }
  return map
}

function appendPartial(partialPath, record) {
  if (!partialPath) return
  try {
    mkdirSync(dirname(partialPath), { recursive: true })
    appendFileSync(partialPath, JSON.stringify(record) + '\n')
  } catch {
    // 断点文件写失败不影响主流程
  }
}

function startPartial(partialPath) {
  if (!partialPath) return
  try {
    mkdirSync(dirname(partialPath), { recursive: true })
    writeFileSync(partialPath, '')
  } catch {
    // 保持静默；没有断点文件仍然可以正常批量
  }
}

async function cmdFormat(opts) {
  const input = readInput(opts._[1])
  const field = opts.field || 'auto'
  if (!VALID_FIELDS.has(field)) die(`--field 只能是 stem / body / answer / auto，收到 ${field}`)
  const maxTokens = opts.maxTokens || DEFAULT_MAX_TOKENS
  if (opts.resume && !opts.batch) die('--resume 只能用于 --batch')

  const call = (args) =>
    formatQuestion({
      ...args,
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
      model: opts.model,
      maxTokens,
      timeoutMs: opts.timeoutMs
    })

  if (opts.batch) {
    if (opts.resume && !opts.out) die('--resume 需要同时指定 --out')
    let items
    try {
      items = JSON.parse(input)
    } catch (e) {
      die(`批量输入不是合法 JSON：${e.message}`)
    }
    if (!Array.isArray(items)) die('批量输入必须是 JSON 数组 [{id, text, field}]')

    const partialPath = opts.out ? resolve(opts.out) + '.partial' : ''
    const previous = opts.resume && opts.out ? loadPrevious(resolve(opts.out), partialPath) : new Map()
    startPartial(partialPath)
    const cacheDir = cacheDirOf(opts)

    const results = await mapLimit(items, opts.concurrency || 3, async (item, index) => {
      const label = item?.id ?? `#${index + 1}`
      const text = item?.text ?? item?.content ?? ''
      const itemField = item?.field || field
      const id = item?.id ?? index
      const hashCode = inputHash({ text, field: itemField })
      const prev = previous.get(idKey(id))
      if (
        prev &&
        prev.ok &&
        typeof prev.html === 'string' &&
        (!prev.inputHash || prev.inputHash === hashCode)
      ) {
        process.stderr.write(`[${index + 1}/${items.length}] ${label} 跳过（已完成）\n`)
        return { ...prev, resumed: true }
      }
      try {
        if (!VALID_FIELDS.has(itemField)) {
          const e = new Error(`field 只能是 stem / body / answer / auto，收到 ${itemField}`)
          e.code = 'INVALID_FIELD'
          throw e
        }
        const cacheKey = cacheKeyFor(opts, itemField, text)
        const cached = cacheKey ? readCache(cacheDir, cacheKey) : null
        let r
        let cachedHit = false
        if (cached) {
          r = cached
          cachedHit = true
        } else {
          r = await withRetry(() => call({ text, field: itemField }))
          if (cacheKey) writeCache(cacheDir, cacheKey, r)
        }
        const record = {
          id,
          ok: true,
          html: r.html,
          changed: r.changed,
          removedAnswer: r.removedAnswer,
          cached: cachedHit,
          inputHash: hashCode
        }
        appendPartial(partialPath, record)
        process.stderr.write(`[${index + 1}/${items.length}] ${label} ${cachedHit ? 'cached' : 'ok'}\n`)
        return record
      } catch (e) {
        const record = { id, ok: false, error: e.message, code: e.code }
        appendPartial(partialPath, record)
        process.stderr.write(`[${index + 1}/${items.length}] ${label} 失败：${e.message}\n`)
        return record
      }
    })

    const failed = results.filter((r) => !r.ok).length
    emit(JSON.stringify(results, null, 2), opts.out)
    if (partialPath) rmSync(partialPath, { force: true })
    if (failed) process.exitCode = 1
    return
  }

  const cacheKey = cacheKeyFor(opts, field, input)
  const cached = cacheKey ? readCache(cacheDirOf(opts), cacheKey) : null
  let result
  let cachedHit = false
  if (cached) {
    result = cached
    cachedHit = true
    process.stderr.write('qformat: 缓存命中\n')
  } else {
    result = await call({ text: input, field })
    if (cacheKey) writeCache(cacheDirOf(opts), cacheKey, result)
  }

  emit(
    opts.json
      ? JSON.stringify(
          {
            html: result.html,
            changed: result.changed,
            dropped: result.dropped ?? false,
            removedAnswer: result.removedAnswer,
            cached: cachedHit
          },
          null,
          2
        )
      : result.html,
    opts.out
  )
}

function cmdRepair(opts) {
  const input = readInput(opts._[1])
  const { html, changed } = normalizeAiMathHtml(input)
  if (!changed) process.stderr.write('qformat: 未发现需要修复的内容\n')
  emit(opts.json ? JSON.stringify({ html, changed }, null, 2) : html, opts.out)
}

async function cmdVerify(opts) {
  const input = readInput(opts._[1])
  const { total, failed } = await validateAiMath(input)
  if (opts.json) {
    process.stdout.write(JSON.stringify({ total, failed }, null, 2) + '\n')
    if (failed.length) process.exitCode = 1
    return
  }
  if (!total) {
    process.stderr.write('qformat: 未找到任何 $...$ 公式\n')
    process.exitCode = 0
    return
  }
  const summary = `共 ${total} 段公式，失败 ${failed.length} 段`
  process.stderr.write(`qformat: ${summary}\n`)
  if (failed.length) {
    for (const f of failed) process.stdout.write(`FAIL\t${f.content}\t${f.error}\n`)
    process.exitCode = 1
  }
}

function cmdGuard(opts) {
  const html = readInput(opts._[1])
  let sourceText
  if (opts.sourceText !== undefined) sourceText = opts.sourceText
  else if (opts.source) sourceText = readInput(opts.source, '原文')
  else die('guard 需要 --source <原文文件> 或 --source-text <原文>')

  const field = opts.field || 'auto'
  if (!VALID_FIELDS.has(field)) die(`--field 只能是 stem / body / answer / auto，收到 ${field}`)

  const result = guardHtml({
    sourceText,
    html,
    field,
    sanitize: Boolean(opts.sanitize)
  })
  for (const fix of result.fixes) process.stderr.write(`qformat: 已修复 ${fix}\n`)
  for (const error of result.errors) {
    process.stderr.write(`qformat: ${error.code} — ${error.message}\n`)
  }
  // 警告不改退出码：次数类偏差（题号被吞、同一数字少写一次）需要人来判断严重程度
  for (const warning of result.warnings || []) {
    process.stderr.write(`qformat: 提示 ${warning.code} — ${warning.message}\n`)
  }
  emit(opts.json ? JSON.stringify(result, null, 2) : result.html, opts.out)
  if (result.errors.length) process.exitCode = 1
}

function cmdSanitize(opts) {
  const input = readInput(opts._[1])
  const html = sanitizeHtml(cleanAiHtml(input))
  emit(opts.json ? JSON.stringify({ html, changed: html !== input.trim() }, null, 2) : html, opts.out)
}

async function main() {
  loadDotEnv()
  // skill 根目录的 .env 也读一次（不覆盖 cwd 已设置的变量）
  loadDotEnv(resolve(dirname(fileURLToPath(import.meta.url)), '..'))

  const opts = parseArgs(process.argv.slice(2))
  if (opts.version) {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    process.stdout.write(`${pkg.version}\n`)
    return
  }
  const cmd = opts._[0]
  if (opts.help || !cmd) {
    process.stdout.write(HELP)
    if (!cmd && !opts.help) process.exitCode = 2
    return
  }

  try {
    if (cmd === 'format') return await cmdFormat(opts)
    if (cmd === 'repair') return cmdRepair(opts)
    if (cmd === 'verify') return await cmdVerify(opts)
    if (cmd === 'guard') return cmdGuard(opts)
    if (cmd === 'sanitize') return cmdSanitize(opts)
    die(`未知命令：${cmd}（可用：format / repair / verify / guard / sanitize）`)
  } catch (e) {
    if (e?.code === 'NO_API_KEY') die(e.message)
    if (e?.code === 'KATEX_MISSING') die(e.message)
    die(e?.message || String(e), 1)
  }
}

main()
