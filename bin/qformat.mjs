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
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDotEnv } from '../src/env.mjs'
import {
  formatQuestion,
  normalizeAiMathHtml,
  validateAiMath,
  guardHtml
} from '../src/index.mjs'

const HELP = `qformat —— 把一段题目文本整理成规范 HTML（数学公式用 KaTeX）

用法
  qformat format <输入>            调用大模型排版（需要 AI_API_KEY）
  qformat format <输入> --batch    批量：输入为 JSON 数组 [{id,text,field}]
  qformat repair <输入>            本地公式修复：Unicode → LaTeX、定界符归一，不联网
  qformat verify <输入>            KaTeX 逐段校验公式，有失败则退出码 1
  qformat guard <输入>             离线守卫：清洗、防泄题、公式归一、数字/选项守恒校验

输入
  文件路径，或 - 表示从标准输入读取

选项
  --field <stem|body|answer|auto>  字段身份，默认 auto。
                                   stem/body 会删掉模型凭空补出的答案解析；
                                   answer 表示这段内容本身就是答案，原样放行。
  --source <文件>                  guard 专用：用户原文（用于防泄题与守恒比对）
  --source-text <文本>             guard 专用：直接传原文文本
  --out <文件>                     结果写入文件（默认打印到 stdout）
  --json                           以 JSON 输出（guard 输出 html/fixes/errors）
  --batch                          format 专用：输入按 JSON 数组处理
  --concurrency <n>                批量并发数，默认 3
  --api-key <key>                  覆盖 AI_API_KEY
  --base-url <url>                 覆盖 AI_BASE_URL，默认 https://api.deepseek.com/v1
  --model <name>                   覆盖 AI_MODEL，默认 deepseek-chat
  --timeout <ms>                   单次请求超时，默认 120000
  -h, --help                       显示本帮助
  -v, --version                    显示版本

示例
  echo '已知f(x)=x²-2x+3，求f(2)的值。' | qformat format - --field stem
  qformat repair 题库.txt --out 题库.html
  qformat guard 整理后.html --source 原文.txt --field stem
  qformat format 题目.json --batch --out 结果.json --concurrency 3
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

async function cmdFormat(opts) {
  const input = readInput(opts._[1])
  const field = opts.field || 'auto'
  if (!VALID_FIELDS.has(field)) die(`--field 只能是 stem / body / answer / auto，收到 ${field}`)

  const call = (args) =>
    formatQuestion({ ...args, apiKey: opts.apiKey, baseUrl: opts.baseUrl, model: opts.model, timeoutMs: opts.timeoutMs })

  if (opts.batch) {
    let items
    try {
      items = JSON.parse(input)
    } catch (e) {
      die(`批量输入不是合法 JSON：${e.message}`)
    }
    if (!Array.isArray(items)) die('批量输入必须是 JSON 数组 [{id, text, field}]')

    const results = await mapLimit(items, opts.concurrency || 3, async (item, index) => {
      const label = item?.id ?? `#${index + 1}`
      const text = item?.text ?? item?.content ?? ''
      const itemField = item?.field || field
      try {
        if (!VALID_FIELDS.has(itemField)) {
          const e = new Error(`field 只能是 stem / body / answer / auto，收到 ${itemField}`)
          e.code = 'INVALID_FIELD'
          throw e
        }
        const r = await withRetry(() => call({ text, field: itemField }))
        process.stderr.write(`[${index + 1}/${items.length}] ${label} ok\n`)
        return {
          id: item?.id ?? index,
          ok: true,
          html: r.html,
          changed: r.changed,
          removedAnswer: r.removedAnswer
        }
      } catch (e) {
        process.stderr.write(`[${index + 1}/${items.length}] ${label} 失败：${e.message}\n`)
        return { id: item?.id ?? index, ok: false, error: e.message, code: e.code }
      }
    })
    const failed = results.filter((r) => !r.ok).length
    emit(JSON.stringify(results, null, 2), opts.out)
    if (failed) process.exitCode = 1
    return
  }

  const result = await call({ text: input, field })
  emit(
    opts.json
      ? JSON.stringify(
          {
            html: result.html,
            changed: result.changed,
            dropped: result.dropped,
            removedAnswer: result.removedAnswer
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

  const result = guardHtml({ sourceText, html, field })
  for (const fix of result.fixes) process.stderr.write(`qformat: 已修复 ${fix}\n`)
  for (const error of result.errors) {
    process.stderr.write(`qformat: ${error.code} — ${error.message}\n`)
  }
  emit(opts.json ? JSON.stringify(result, null, 2) : result.html, opts.out)
  if (result.errors.length) process.exitCode = 1
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
    die(`未知命令：${cmd}（可用：format / repair / verify / guard）`)
  } catch (e) {
    if (e?.code === 'NO_API_KEY') die(e.message)
    if (e?.code === 'KATEX_MISSING') die(e.message)
    die(e?.message || String(e), 1)
  }
}

main()
