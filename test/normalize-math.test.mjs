import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAiMathHtml, extractMath } from '../src/normalize-math.mjs'

test('定界符归一：\\(...\\) → $...$、\\[...\\] → $$...$$', () => {
  assert.equal(normalizeAiMathHtml('求 \\(x-2\\) 的值').html, '求 $x-2$ 的值')
  assert.equal(normalizeAiMathHtml('\\[a=b\\]').html, '$$a=b$$')
})

test('行内公式内的 Unicode 上标转 ^', () => {
  assert.equal(normalizeAiMathHtml('已知 $x²+1$ 恒正').html, '已知 $x^2+1$ 恒正')
})

test('行内公式内的希腊字母与不等号转命令', () => {
  assert.equal(normalizeAiMathHtml('$α ≥ 0$').html, '$\\alpha \\ge 0$')
})

test('√(…) 与 √x 转 \\sqrt', () => {
  assert.equal(normalizeAiMathHtml('$√(x+1)$').html, '$\\sqrt{x+1}$')
  assert.equal(normalizeAiMathHtml('$√x$').html, '$\\sqrt{x}$')
})

test('$$ 块内多余 $ 被清除、空白压缩', () => {
  assert.equal(normalizeAiMathHtml('$$ x² $  = 1 $$').html, '$$x^2 = 1$$')
})

test('定界符外的 Unicode 符号不动（已知边界）', () => {
  const src = '<p>x²≥0 且 价格 ≥ 5 元</p>'
  assert.equal(normalizeAiMathHtml(src).html, src)
})

test('changed 标记只在真的改动时为 true', () => {
  assert.equal(normalizeAiMathHtml('<p>纯文字</p>').changed, false)
  assert.equal(normalizeAiMathHtml('$x²$').changed, true)
})

test('空输入安全返回', () => {
  assert.deepEqual(normalizeAiMathHtml(''), { html: '', changed: false })
})

test('extractMath 抽出全部公式并区分 display', () => {
  const got = extractMath('设 $a=1$，则 $$b=2$$')
  assert.deepEqual(got, [
    { content: 'a=1', display: false },
    { content: 'b=2', display: true }
  ])
})
