// 离线守卫用例：覆盖「能确定性发现」的四类事故——泄题、改数字、丢条件、加选项。
import test from 'node:test'
import assert from 'node:assert/strict'
import { guardHtml } from '../src/guard.mjs'

test('干净输出通过', () => {
  const r = guardHtml({
    sourceText: '已知 f(x)=x²，求 f(2)。',
    html: '<p>已知 $f(x)=x^{2}$，求 $f(2)$。</p>',
    field: 'stem'
  })
  assert.equal(r.ok, true)
  assert.deepEqual(r.errors, [])
  assert.equal(r.removedAnswer, false)
})

test('模型补写的答案被删除，并记录为已修复', () => {
  const r = guardHtml({
    sourceText: '求 f(2)。',
    html: '<p>求 $f(2)$。</p><p>答案：4</p>',
    field: 'stem'
  })
  assert.equal(r.html, '<p>求 $f(2)$。</p>')
  assert.equal(r.removedAnswer, true)
  assert.ok(r.fixes.includes('REMOVED_UNREQUESTED_ANSWER'))
  assert.equal(r.ok, true)
})

test('新增数字被报错', () => {
  const r = guardHtml({
    sourceText: '求 f(2)。',
    html: '<p>求 $f(3)$。</p>',
    field: 'stem'
  })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.code === 'ADDED_NUMBER'))
})

test('丢失数字被报错', () => {
  const r = guardHtml({
    sourceText: 'f(x)=x²-2x+3',
    html: '<p>$f(x)=x^{2}-2x$</p>',
    field: 'stem'
  })
  assert.ok(r.errors.some((e) => e.code === 'LOST_NUMBER'))
})

test('新增选项被报错', () => {
  const r = guardHtml({
    sourceText: '求 f(2) 的值。',
    html: '<p>求 $f(2)$ 的值。</p><p>A. 4</p>',
    field: 'stem'
  })
  assert.ok(r.errors.some((e) => e.code === 'ADDED_OPTION'))
})

test('原文已有选项时不误报', () => {
  const r = guardHtml({
    sourceText: '求 f(2)。\nA.1 B.3 C.5 D.7',
    html: '<p>求 $f(2)$。</p><p>A. 1</p><p>B. 3</p><p>C. 5</p><p>D. 7</p>',
    field: 'stem'
  })
  assert.equal(r.ok, true)
})

test('标签外裸文本被报错', () => {
  const r = guardHtml({
    sourceText: '已知 x。',
    html: '<p>已知 $x$。</p>\n请核对。',
    field: 'stem'
  })
  assert.ok(r.errors.some((e) => e.code === 'TEXT_OUTSIDE_TAGS'))
})

test('裸 $ 被报错', () => {
  const r = guardHtml({
    sourceText: '价格 5 元。',
    html: '<p>价格 $5 元。</p>',
    field: 'stem'
  })
  assert.ok(r.errors.some((e) => e.code === 'BARE_DOLLAR'))
})

test('残留 Unicode 数学符号被报错', () => {
  const r = guardHtml({
    sourceText: '√(x+(y))',
    html: '<p>$√(x+(y))$</p>',
    field: 'stem'
  })
  assert.ok(r.errors.some((e) => e.code === 'UNICODE_MATH_LEFT'))
})

test('危险标签被报错', () => {
  const r = guardHtml({
    sourceText: '求 x。',
    html: '<p>求 $x$。</p><script>alert(1)</script>',
    field: 'stem'
  })
  assert.ok(r.errors.some((e) => e.code === 'DANGEROUS_TAG'))
})

test('field=answer 时原样保留答案', () => {
  const r = guardHtml({
    sourceText: '答案：4',
    html: '<p><strong>答案：</strong>4</p>',
    field: 'answer'
  })
  assert.equal(r.removedAnswer, false)
  assert.equal(r.ok, true)
})

test('整份都是补写的答案时返回空串并报错', () => {
  const r = guardHtml({ sourceText: '求 x。', html: '<p>答案：4</p>', field: 'stem' })
  assert.equal(r.html, '')
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.code === 'ALL_ANSWERS_DROPPED'))
})
