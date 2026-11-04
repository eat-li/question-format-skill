// 缓存用例：键必须覆盖所有影响输出的参数，损坏文件要静默降级。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatCacheKey, inputHash, readCache, writeCache } from '../src/cache.mjs'

const base = {
  text: '已知f(x)=x²，求f(2)。',
  field: 'stem',
  base: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  temperature: 0.2,
  maxTokens: 4096
}

test('缓存键随文本、字段、模型变化', () => {
  const key = formatCacheKey(base)
  assert.equal(key, formatCacheKey({ ...base }))
  assert.notEqual(key, formatCacheKey({ ...base, text: '求 x。' }))
  assert.notEqual(key, formatCacheKey({ ...base, field: 'answer' }))
  assert.notEqual(key, formatCacheKey({ ...base, model: 'other' }))
  assert.notEqual(key, formatCacheKey({ ...base, maxTokens: 8192 }))
})

test('写入后可读回，损坏文件返回 null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qformat-cache-'))
  try {
    const key = formatCacheKey(base)
    assert.equal(readCache(dir, key), null)
    writeCache(dir, key, { html: '<p>x</p>', changed: true, removedAnswer: false })
    const got = readCache(dir, key)
    assert.equal(got.html, '<p>x</p>')
    assert.equal(got.changed, true)
    assert.equal(got.removedAnswer, false)

    writeFileSync(join(dir, `${key}.json`), '{broken')
    assert.equal(readCache(dir, key), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('断点哈希随文本与字段变化', () => {
  assert.equal(inputHash({ text: '求 x。', field: 'stem' }), inputHash({ text: '求 x。', field: 'stem' }))
  assert.notEqual(inputHash({ text: '求 x。', field: 'stem' }), inputHash({ text: '求 y。', field: 'stem' }))
  assert.notEqual(inputHash({ text: '求 x。', field: 'stem' }), inputHash({ text: '求 x。', field: 'answer' }))
})
