// 编排层测试：注入假的 call，不联网、不需要 API Key。
// 这组用例确保「清洗 → 防泄题 → 公式规范化」的顺序与短路行为不被改坏。
import test from 'node:test'
import assert from 'node:assert/strict'
import { postProcess, formatQuestion } from '../src/index.mjs'

const fakeCall = (reply) => async () => reply

test('postProcess：围栏 + 文档壳 + 定界符一次清干净', () => {
  const raw = '```html\n<html><body><p>求 \\(x-2\\) 的值</p></body></html>\n```'
  const r = postProcess(raw, '求 x-2 的值', 'stem')
  assert.equal(r.html, '<p>求 $x-2$ 的值</p>')
  assert.equal(r.dropped, false)
})

test('postProcess：多出来的答案解析被删掉', () => {
  const raw = '<p>求 $f(2)$。</p><p>答案：4</p>'
  const r = postProcess(raw, '求 f(2)。', 'stem')
  assert.equal(r.html, '<p>求 $f(2)$。</p>')
})

test('postProcess：整份都是答案时 dropped=true', () => {
  const r = postProcess('<p>答案：4</p>', '求 f(2)。', 'stem')
  assert.equal(r.dropped, true)
  assert.equal(r.html, '')
})

test('postProcess：field=answer 时保留答案解析', () => {
  const raw = '<p><strong>答案：</strong>4</p><p><strong>解析：</strong>代入。</p>'
  assert.equal(postProcess(raw, '求 f(2)', 'answer').html, raw)
})

test('formatQuestion：空输入直接报错，不发请求', async () => {
  let called = false
  await assert.rejects(
    () => formatQuestion({ text: '   ', call: async () => ((called = true), '') }),
    (e) => e.code === 'EMPTY_INPUT'
  )
  assert.equal(called, false)
})

test('formatQuestion：正常路径返回清洗后的 HTML', async () => {
  const r = await formatQuestion({
    text: '已知f(x)=x²-2x+3，求f(2)的值。',
    field: 'stem',
    apiKey: 'test-key',
    call: fakeCall('<p>已知 $f(x)=x^2-2x+3$，求 $f(2)$ 的值。</p>')
  })
  assert.equal(r.html, '<p>已知 $f(x)=x^2-2x+3$，求 $f(2)$ 的值。</p>')
  assert.equal(r.dropped, false)
})

test('formatQuestion：模型只回答案时抛 ALL_ANSWERS_DROPPED', async () => {
  await assert.rejects(
    () =>
      formatQuestion({
        text: '求 f(2)',
        field: 'stem',
        apiKey: 'test-key',
        call: fakeCall('<p>答案：4</p>')
      }),
    (e) => e.code === 'ALL_ANSWERS_DROPPED'
  )
})

test('formatQuestion：模型回空内容时抛 EMPTY_RESULT', async () => {
  await assert.rejects(
    () => formatQuestion({ text: '求 x', apiKey: 'test-key', call: fakeCall('   ') }),
    (e) => e.code === 'EMPTY_RESULT'
  )
})

test('postProcess：报告删除的答案与清理的围栏', () => {
  const r = postProcess(
    '以下是整理后的内容：\n```html\n<p>求 $x$。</p><p>故答案为 4</p>\n```',
    '求 x。',
    'stem'
  )
  assert.equal(r.html, '<p>求 $x$。</p>')
  assert.equal(r.removedAnswer, true)
  assert.equal(r.dropped, false)
})

test('formatQuestion：系统提示带上字段规则，并传 maxTokens', async () => {
  let seen
  const call = async (args) => {
    seen = args
    return '<p><strong>答案：</strong>4</p>'
  }
  const r = await formatQuestion({
    text: '答案：4',
    field: 'answer',
    apiKey: 'test-key',
    maxTokens: 8192,
    call
  })
  assert.equal(r.html, '<p><strong>答案：</strong>4</p>')
  assert.match(seen.messages[0].content, /答案与解析/)
  assert.equal(seen.maxTokens, 8192)
})
