// CLI 冒烟：不联网，验证 repair / guard 的输入输出与退出码。
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const bin = fileURLToPath(new URL('../bin/qformat.mjs', import.meta.url))

function run(args, options = {}) {
  return spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', ...options })
}

test('CLI repair 从 stdin 读入并修复命令边界', () => {
  const r = run(['repair', '-'], { input: '$∠A=30°$' })
  assert.equal(r.status, 0)
  assert.equal(r.stdout.trim(), '$\\angle A=30^\\circ$')
})

test('CLI guard 删除补写的答案并返回 0', () => {
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

test('CLI guard 发现新增数字时退出码为 1', () => {
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

test('CLI guard --json 输出结构化结果', () => {
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

test('CLI 拒绝非法 --timeout', () => {
  const r = run(['format', '-', '--timeout=abc'], { input: 'x' })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /--timeout/)
})
