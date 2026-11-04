// 防泄题用例。这组测试的价值不在覆盖率，而在守住一条线：
// 题干会直接展示给学生，模型多写一段「答案：5」就等于把答案漏出去。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  stripUnrequestedAnswer,
  stripUnrequestedAnswerDetailed
} from '../src/strip-answer.mjs'

test('field=answer 时原样放行', () => {
  const html = '<p>答案：$x=1$</p>'
  assert.equal(stripUnrequestedAnswer('求 x', html, 'answer'), html)
})

test('原文只提到「答案」但没有答案内容时，仍删除补写的答案', () => {
  const html = '<p>题干</p><p>答案：5</p>'
  assert.equal(stripUnrequestedAnswer('把答案填在横线上', html, 'stem'), '<p>题干</p>')
})

test('原文只提到「解析过程」时，仍删除补写的解析', () => {
  const html = '<p>题干</p><p><strong>解析：</strong>略</p>'
  assert.equal(stripUnrequestedAnswer('要求写出解析过程', html, 'stem'), '<p>题干</p>')
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

test('故答案为 / 正确答案是 / 故选 都能识别', () => {
  const cases = [
    '<p>求 $x$。</p><p>故答案为 4</p>',
    '<p>求 $x$。</p><p>正确答案是 4</p>',
    '<p>求 $x$。</p><p>故选：A</p>',
    '<p>求 $x$。</p><p>所以选 A</p>'
  ]
  for (const html of cases) {
    assert.equal(stripUnrequestedAnswer('求 x。', html, 'stem'), '<p>求 $x$。</p>', html)
  }
})

test('同段逗号后的答案被截断，不留孤零零的逗号', () => {
  assert.equal(
    stripUnrequestedAnswer('求 x。', '<p>求 $x$，答案：4</p>', 'stem'),
    '<p>求 $x$</p>'
  )
})

test('无冒号的 strong 答案标记也识别', () => {
  assert.equal(
    stripUnrequestedAnswer('求 x。', '<p>求 $x$。</p><p><strong>答案</strong> 4</p>', 'stem'),
    '<p>求 $x$。</p>'
  )
})

test('「解答：」形式被识别', () => {
  assert.equal(
    stripUnrequestedAnswer('求 x。', '<p>求 $x$。</p><p>解答：4</p>', 'stem'),
    '<p>求 $x$。</p>'
  )
})

test('原文含「解析式」不会关闭防泄题', () => {
  const html = '<p>求函数的解析式。</p><p>答案：y=2x+1</p>'
  assert.equal(stripUnrequestedAnswer('求函数的解析式。', html, 'stem'), '<p>求函数的解析式。</p>')
})

test('原文含「解析几何」不会关闭防泄题', () => {
  const html = '<p>解析几何题。</p><p>解析：代入。</p>'
  assert.equal(stripUnrequestedAnswer('解析几何题。', html, 'stem'), '<p>解析几何题。</p>')
})

test('原文以「答案是」给出答案时保留', () => {
  const html = '<p>题干</p><p><strong>答案：</strong>4</p>'
  assert.equal(stripUnrequestedAnswer('题干。答案是 4', html, 'stem'), html)
})

test('同一段里的加粗答案标记也能截断', () => {
  assert.equal(
    stripUnrequestedAnswer('求 x。', '<p>求 $x$。<strong>答案</strong> 4</p>', 'stem'),
    '<p>求 $x$。</p>'
  )
})

test('「故选址」「答案选项」这类正文不会误判', () => {
  const html = '<p>某公司要选址建厂，故选址方案如下。</p><p>答案选项见附表。</p>'
  assert.equal(
    stripUnrequestedAnswer('某公司要选址建厂，故选址方案如下。答案选项见附表。', html, 'stem'),
    html
  )
})

test('详细接口报告是否发生截断', () => {
  const removed = stripUnrequestedAnswerDetailed('求 x。', '<p>求 $x$。</p><p>答案：4</p>', 'stem')
  assert.deepEqual(removed, { html: '<p>求 $x$。</p>', removed: true })
  const kept = stripUnrequestedAnswerDetailed('求 x。', '<p>求 $x$。</p>', 'stem')
  assert.deepEqual(kept, { html: '<p>求 $x$。</p>', removed: false })
})
