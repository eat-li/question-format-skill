#!/usr/bin/env node
// qformat —— 题目排版命令行
//
//   qformat format <file|-> [--field stem|body|answer|auto] [--out f.html] [--json]
//   qformat format <batch.json> --batch [--out result.json]
//   qformat repair <file|-> [--out f.html]
//   qformat verify <file|->
//
// 输入为 `-` 时读 stdin。format 需要 AI_API_KEY（.env 或环境变量）。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { loadDotEnv } from '../src/env.mjs'
import { formatQuestion, normalizeAiMathHtml, validateAiMath } from '../src/index.mjs'

const HELP = `qformat —— 把一段题目文本整理成规范 HTML（数学公式用 KaTeX）

用法
  qformat format <输入>            调用大模型排版（需要 AI_API_KEY）
  qformat format <输入> --batch    批量：输入为 JSON 数组 [{id,text,field}]
  qformat repair <输入>            本地公式修复：Unicode → LaTeX、定界符归一，不联网
  qformat verify <输入>            KaTeX 逐段校验公式，有失败则退出码 1

输入
  文件路径，或 - 表示从标准输入读取

选项
  --field <stem|body|answer|auto>  字段身份，默认 auto。
                                   stem/body 会删掉模型凭空补出的答案解析；
                                   answer 表示这段内容本身就是答案，原样放行。
  --out <文件>                     结果写入文件（默认打印到 stdout）
  --json                           以 JSON 输出 {html, changed, dropped}
  --batch                          format 专用：输入按 JSON 数组处理
  --api-key <key>                  覆盖 AI_API_KEY
  --base-url <url>                 覆盖 AI_BASE_URL，默认 https://api.deepseek.com/v1
  --model <name>                   覆盖 AI_MODEL，默认 deepseek-chat
  --timeout <ms>                   单次请求超时，默认 120000
  -h, --help                       显示本帮助
  -v, --version                    显示版本

示例
  echo '已知f(x)=x²-2x+3，求f(2)的值。' | qformat format - --field stem
  qformat repair 题库.txt --out 题库.html
  qformat format 题目.json --batch --out 结果.json
`

function parseArgs(argv) {
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
      case '--timeout':
        opts.timeoutMs = Number(takeValue())
        break
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

function readInput(spec) {
  if (spec === '-' || spec === undefined) {
    try {
      return readFileSync(0, 'utf8')
    } catch {
      die('无法读取标准输入')
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

    const results = []
    for (const [index, item] of items.entries()) {
      const label = item?.id ?? `#${index + 1}`
      const text = item?.text ?? item?.content ?? ''
      try {
        const r = await call({ text, field: item?.field || field })
        results.push({ id: item?.id ?? index, ok: true, html: r.html, changed: r.changed })
        process.stderr.write(`[${index + 1}/${items.length}] ${label} ok\n`)
      } catch (e) {
        results.push({ id: item?.id ?? index, ok: false, error: e.message, code: e.code })
        process.stderr.write(`[${index + 1}/${items.length}] ${label} 失败：${e.message}\n`)
      }
    }
    const failed = results.filter((r) => !r.ok).length
    emit(JSON.stringify(results, null, 2), opts.out)
    if (failed) process.exitCode = 1
    return
  }

  const result = await call({ text: input, field })
  emit(
    opts.json
      ? JSON.stringify({ html: result.html, changed: result.changed, dropped: result.dropped }, null, 2)
      : result.html,
    opts.out
  )
}

function cmdRepair(opts) {
  const input = readInput(opts._[1])
  const { html, changed } = normalizeAiMathHtml(input)
  if (!changed) process.stderr.write('qformat: 未发现需要修复的内容\n')
  emit(opts.json ? JSON.stringify({ html, changed }, null, 2) : html, opts.out)
  if (!changed) process.exitCode = 0
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

async function main() {
  loadDotEnv()
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
    die(`未知命令：${cmd}（可用：format / repair / verify）`)
  } catch (e) {
    if (e?.code === 'NO_API_KEY') die(e.message)
    if (e?.code === 'KATEX_MISSING') die(e.message)
    die(e?.message || String(e), 1)
  }
}

main()
