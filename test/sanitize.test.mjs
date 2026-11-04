// HTML 消毒用例：题目输出会进预览页，危险标签与属性必须确定性清掉。
import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeHtml } from '../src/sanitize.mjs'

test('删除 script/style 及其内容', () => {
  assert.equal(sanitizeHtml('<p onclick="x">hi<script>alert(1)</script></p>'), '<p>hi</p>')
  assert.equal(sanitizeHtml('<style>body{color:red}</style><p>x</p>'), '<p>x</p>')
})

test('图片只保留安全 src / alt / width / height', () => {
  assert.equal(
    sanitizeHtml('<img src="javascript:alert(1)" onerror="x" alt="图">'),
    '<img alt="图">'
  )
  assert.equal(
    sanitizeHtml('<img src="https://a/b.png" width="100" style="x">'),
    '<img src="https://a/b.png" width="100">'
  )
  assert.equal(
    sanitizeHtml('<img src="data:image/png;base64,AAA" alt="x">'),
    '<img src="data:image/png;base64,AAA" alt="x">'
  )
  assert.equal(sanitizeHtml('<img src="data:text/html,x" alt="x">'), '<img alt="x">')
  assert.equal(sanitizeHtml('<img src="java\nscript:alert(1)" alt="x">'), '<img alt="x">')
  assert.equal(sanitizeHtml('<img src="&#106;avascript:alert(1)" alt="x">'), '<img alt="x">')
  assert.equal(sanitizeHtml('<img src="java&#x0A;script:alert(1)" alt="x">'), '<img alt="x">')
  assert.equal(
    sanitizeHtml('<img src="https://a/b?x=1&amp;y=2" alt="a&amp;b">'),
    '<img src="https://a/b?x=1&amp;y=2" alt="a&amp;b">'
  )
})

test('未知标签拆掉但保留文字', () => {
  assert.equal(sanitizeHtml('<div><span>hi</span></div>'), 'hi')
  assert.equal(sanitizeHtml('<a href="https://x">link</a>'), 'link')
})

test('补齐错位标签，删掉未知闭合标签', () => {
  assert.equal(sanitizeHtml('<p><strong>x</p>'), '<p><strong>x</strong></p>')
  assert.equal(sanitizeHtml('<p>x</span></p>'), '<p>x</p>')
})

test('公式里的 < 不会被当成标签', () => {
  assert.equal(sanitizeHtml('<p>$x<0$ 且 $a<b$</p>'), '<p>$x<0$ 且 $a<b$</p>')
})

test('表格属性只保留 colspan / rowspan', () => {
  assert.equal(
    sanitizeHtml('<table><tr><td colspan="2" onclick="x">A</td></tr></table>'),
    '<table><tr><td colspan="2">A</td></tr></table>'
  )
})

test('void 标签与自闭合标签', () => {
  assert.equal(sanitizeHtml('<p>a<br/>b</p>'), '<p>a<br>b</p>')
  assert.equal(sanitizeHtml('<p/>'), '<p></p>')
})

test('注释与 doctype 被去掉', () => {
  assert.equal(sanitizeHtml('<!DOCTYPE html><!--x--><p>a</p>'), '<p>a</p>')
})

test('非法数字实体不会让消毒器崩溃', () => {
  assert.equal(sanitizeHtml('<img alt="&#99999999;">'), '<img alt="">')
})
