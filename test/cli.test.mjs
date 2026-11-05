// CLI 冒烟：不联网，验证 repair / guard / sanitize 的输入输出与退出码。
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const bin = fileURLToPath(new URL('../bin/qformat.mjs', import.meta.url))

// 受限沙箱（部分容器 / IDE 沙箱）会拒绝对子进程的 spawn，返回 EPERM。
// 那不是代码缺陷，所以整组跳过，而不是让 CI 变红——真实 CI 里 spawn 一定可用。
const spawnBlocked = (() => {
  const probe = spawnSync(process.execPath, ['-e', '0'], { encoding: 'utf8' })
  return probe.error?.code === 'EPERM' || probe.error?.code === 'EACCES'
})()

if (spawnBlocked) {
  console.warn('# CLI 冒烟测试跳过：当前环境不允许 spawn 子进程（EPERM）')
}

/** 环境允许 spawn 时注册用例，否则跳过 */
function cliTest(name, fn) {
  return test(name, { skip: spawnBlocked ? '当前环境不允许 spawn 子进程' : false }, fn)
}

function run(args, options = {}) {
  return spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', ...options })
}

function runAsync(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}

cliTest('CLI repair 从 stdin 读入并修复命令边界', () => {
  const r = run(['repair', '-'], { input: '$∠A=30°$' })
  assert.equal(r.status, 0)
  assert.equal(r.stdout.trim(), '$\\angle A=30^\\circ$')
})

cliTest('CLI guard 删除补写的答案并返回 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qformat-'))
  try {
    const file = join(dir, 'out.html')
    writeFileSync(file, '<p>求 $f(2)$。</p><p>答案：4</p>')
    const r = run(['guard', file, '--source-text', '求 f(2)。', '--field', 'stem'])
    assert.equal(r.status, 0)
    assert.equal(r.stdout.trim(), '<p>求 $f(2)$。</p>')
    assert.match(r.stderr, /REMOVED_UNREQUESTED_ANSWER/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

cliTest('CLI guard 发现新增数字时退出码为 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qformat-'))
  try {
    const file = join(dir, 'out.html')
    writeFileSync(file, '<p>求 $f(3)$。</p>')
    const r = run(['guard', file, '--source-text', '求 f(2)。', '--field', 'stem'])
    assert.equal(r.status, 1)
    assert.match(r.stderr, /ADDED_NUMBER/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

cliTest('CLI guard --json 输出结构化结果', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qformat-'))
  try {
    const file = join(dir, 'out.html')
    writeFileSync(file, '<p>求 $f(2)$。</p>')
    const r = run(['guard', file, '--source-text', '求 f(2)。', '--field', 'stem', '--json'])
    assert.equal(r.status, 0)
    const parsed = JSON.parse(r.stdout)
    assert.equal(parsed.ok, true)
    assert.equal(parsed.html, '<p>求 $f(2)$。</p>')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

cliTest('CLI 拒绝非法 --timeout', () => {
  const r = run(['format', '-', '--timeout=abc'], { input: 'x' })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /--timeout/)
})

cliTest('CLI sanitize 清掉 script 与事件属性', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qformat-'))
  try {
    const file = join(dir, 'out.html')
    writeFileSync(file, '<p onclick="x">hi<script>alert(1)</script></p>')
    const r = run(['sanitize', file])
    assert.equal(r.status, 0)
    assert.equal(r.stdout.trim(), '<p>hi</p>')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

cliTest('CLI guard --sanitize 同时完成检查与消毒', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qformat-'))
  try {
    const file = join(dir, 'out.html')
    writeFileSync(file, '<p>求 $x$。</p><script>alert(1)</script>')
    const r = run(['guard', file, '--source-text', '求 x。', '--field', 'stem', '--sanitize'])
    assert.equal(r.status, 0)
    assert.equal(r.stdout.trim(), '<p>求 $x$。</p>')
    assert.match(r.stderr, /SANITIZED/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

cliTest('CLI 批量缓存命中后不再请求上游', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qformat-'))
  let calls = 0
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      calls++
      const text = JSON.parse(body).messages[1].content
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          choices: [{ message: { content: `<p>${text.replace(/x²/g, '$x^{2}$')}</p>` } }]
        })
      )
    })
  })
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port
    const items = join(dir, 'items.json')
    const out = join(dir, 'out.json')
    const cache = join(dir, 'cache')
    writeFileSync(
      items,
      JSON.stringify([
        { id: 1, text: '求x²。', field: 'stem' },
        { id: 2, text: '求x²+1。', field: 'stem' }
      ])
    )
    const args = [
      'format',
      items,
      '--batch',
      '--out',
      out,
      '--api-key',
      'test',
      '--base-url',
      `http://127.0.0.1:${port}/v1`,
      '--cache-dir',
      cache
    ]
    const first = await runAsync(args)
    assert.equal(first.status, 0)
    assert.equal(calls, 2)
    const second = await runAsync(args)
    assert.equal(second.status, 0)
    assert.equal(calls, 2)
    const rows = JSON.parse(readFileSync(out, 'utf8'))
    assert.equal(rows.length, 2)
    assert.ok(rows.every((row) => row.ok))
  } finally {
    await new Promise((resolve) => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  }
})

cliTest('CLI --resume 按 id 跳过已完成项', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qformat-'))
  let calls = 0
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      calls++
      const text = JSON.parse(body).messages[1].content
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          choices: [{ message: { content: `<p>${text.replace(/x²/g, '$x^{2}$')}</p>` } }]
        })
      )
    })
  })
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port
    const items = join(dir, 'items.json')
    const out = join(dir, 'out.json')
    writeFileSync(
      items,
      JSON.stringify([
        { id: 1, text: '求x²。', field: 'stem' },
        { id: 2, text: '求x²+1。', field: 'stem' }
      ])
    )
    writeFileSync(
      out,
      JSON.stringify([{ id: 1, ok: true, html: '<p>已完成</p>', changed: false, removedAnswer: false }])
    )
    const r = await runAsync([
      'format',
      items,
      '--batch',
      '--resume',
      '--no-cache',
      '--out',
      out,
      '--api-key',
      'test',
      '--base-url',
      `http://127.0.0.1:${port}/v1`
    ])
    assert.equal(r.status, 0)
    assert.equal(calls, 1)
    const rows = JSON.parse(readFileSync(out, 'utf8'))
    assert.equal(rows.find((row) => row.id === 1).html, '<p>已完成</p>')
    assert.ok(rows.find((row) => row.id === 2).ok)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  }
})
