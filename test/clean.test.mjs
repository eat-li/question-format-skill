import test from 'node:test'
import assert from 'node:assert/strict'
import { plainText, cleanAiHtml, balanceTags } from '../src/clean.mjs'

test('cleanAiHtml：去代码围栏与文档壳', () => {
  assert.equal(cleanAiHtml('```html\n<p>hi</p>\n```'), '<p>hi</p>')
  assert.equal(cleanAiHtml('<html><head></head><body><p>hi</p></body></html>'), '<p>hi</p>')
})

test('cleanAiHtml：\\(...\\) 与 \\[...\\] 归一为 KaTeX 定界符', () => {
  assert.equal(cleanAiHtml('求 \\(x-2\\) 的值'), '求 $x-2$ 的值')
  assert.equal(cleanAiHtml('\\[a=b\\]'), '$$a=b$$')
  // 公式里含括号是最常见的坑：内层必须能匹配括号
  assert.equal(cleanAiHtml('\\((x-2)(x+1)=0\\)'), '$(x-2)(x+1)=0$')
})

test('plainText：去标签、还原实体、压缩空白', () => {
  assert.equal(plainText('<p>a&nbsp;&amp;&nbsp;b</p>'), 'a & b')
  assert.equal(plainText('<p>  多   空白 </p>'), '多 空白')
})

test('balanceTags：补齐截断留下的未闭合标签', () => {
  assert.equal(balanceTags('<p><strong>题干'), '<p><strong>题干</strong></p>')
  assert.equal(balanceTags('<p>完整</p>'), '<p>完整</p>')
})
