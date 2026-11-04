// 防泄题用例。这组测试的价值不在覆盖率，而在守住一条线：
// 题干会直接展示给学生，模型多写一段「答案：5」就等于把答案漏出去。
import test from 'node:test'
import assert from 'node:assert/strict'
import { stripUnrequestedAnswer } from '../src/strip-answer.mjs'

test('field=answer 时原样放行', () => {
  const html = '<p>答案：$x=1$</p>'
  assert.equal(stripUnrequestedAnswer('求 x', html, 'answer'), html)
})

test('原文本身含「答案」字样时不删', () => {
  const html = '<p>题干</p><p>答案：5</p>'
  assert.equal(stripUnrequestedAnswer('把答案填在横线上', html, 'stem'), html)
})

test('原文含「解析」字样时不删', () => {
  const html = '<p>题干</p><p><strong>解析：</strong>略</p>'
  assert.equal(stripUnrequestedAnswer('要求写出解析过程', html, 'stem'), html)
})

test('模型多写的整段答案解析被整段截掉', () => {
  const html = '<p>已知 $f(x)=x^2$，求 $f(2)$。</p><p>答案：4</p><p>解析：代入即可。</p>'
  assert.equal(
    stripUnrequestedAnswer('已知 f(x)=x^2，求 f(2)。', html, 'stem'),
    '<p>已知 $f(x)=x^2$，求 $f(2)$。</p>'
  )
})

test('同一段里跟在正文后的答案被截断，句号保留', () => {
  const html = '<p>求 $f(2)$ 的值。答案：4</p>'
  assert.equal(stripUnrequestedAnswer('求 f(2) 的值。', html, 'stem'), '<p>求 $f(2)$ 的值。</p>')
})

test('整份输出都是答案时返回空串（由调用方报错）', () => {
  assert.equal(stripUnrequestedAnswer('求 x', '<p>答案：$x=1$</p>', 'stem'), '')
  assert.equal(stripUnrequestedAnswer('求 x', '答案：$x=1$', 'stem'), '')
})

test('正常输出原样保留（不误伤）', () => {
  const html = '<p>已知 $a>0$，求 $\\dfrac{1}{a}$ 的最小值。</p>'
  assert.equal(stripUnrequestedAnswer('已知 a>0，求 1/a 的最小值。', html, 'stem'), html)
})

test('未声明 field 时按 stem 处理（宁可误删，不可泄露）', () => {
  assert.equal(stripUnrequestedAnswer('求 x', '<p>答案：$x=1$</p>'), '')
})

test('【答案】包裹形式同样被识别', () => {
  assert.equal(stripUnrequestedAnswer('求 x', '<p>【答案】$x=1$</p>', 'stem'), '')
})

test('截断后补齐未闭合标签', () => {
  const html = '<p><strong>已知 $a>0$。</strong>答案：1</p>'
  assert.equal(stripUnrequestedAnswer('已知 a>0。', html, 'stem'), '<p><strong>已知 $a>0$。</strong></p>')
})
