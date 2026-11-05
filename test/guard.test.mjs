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

test('丢失选项被报错', () => {
  const r = guardHtml({
    sourceText: '求 f(2)。\nA.1 B.3 C.5 D.7',
    html: '<p>求 $f(2)$。</p><p>A. 1</p><p>B. 3</p><p>C. 5</p>',
    field: 'stem'
  })
  assert.ok(r.errors.some((e) => e.code === 'LOST_OPTION'))
})

test('（A）格式的选项能正确识别', () => {
  const r = guardHtml({
    sourceText: '求 f(2)。\n（A）1 （B）3',
    html: '<p>求 $f(2)$。</p><p>（A）1</p><p>（B）3</p>',
    field: 'stem'
  })
  assert.equal(r.ok, true)
})

test('sanitize 选项会顺手清掉危险标签', () => {
  const r = guardHtml({
    sourceText: '求 x。',
    html: '<p>求 $x$。</p><script>alert(1)</script>',
    field: 'stem',
    sanitize: true
  })
  assert.equal(r.ok, true)
  assert.equal(r.html, '<p>求 $x$。</p>')
  assert.ok(r.fixes.includes('SANITIZED'))
})

test('图片 alt 里的数字不会误报丢失', () => {
  const r = guardHtml({
    sourceText: '如图1所示。',
    html: '<p>如图<img src="x.png" alt="图1">所示。</p>',
    field: 'stem'
  })
  assert.equal(r.ok, true)
})

// —— 以下为真实误报/漏报的回归用例（每条都曾在本机复现过） ——

test('千分位不算改题：1,000 与 1000 等价', () => {
  for (const html of ['<p>总价 1000 元</p>', '<p>总价 1,000 元</p>']) {
    const r = guardHtml({ sourceText: '总价 1,000 元', html, field: 'stem' })
    assert.equal(r.ok, true, `${html} 不应报错：${JSON.stringify(r.errors)}`)
  }
})

test('全角数字与半角数字等价', () => {
  const r = guardHtml({ sourceText: '共１２人', html: '<p>共 12 人</p>', field: 'stem' })
  assert.equal(r.ok, true, JSON.stringify(r.errors))
})

test('科学计数法改写不算新增数字', () => {
  const r = guardHtml({
    sourceText: '总价 3.5万',
    html: '<p>总价 $3.5\\times 10^{4}$</p>',
    field: 'stem'
  })
  assert.equal(r.ok, true, JSON.stringify(r.errors))
})

test('重复数字少一次时报 NUMBER_COUNT_DROPPED 警告（不是硬错误）', () => {
  const r = guardHtml({ sourceText: '2 和 2', html: '<p>2</p>', field: 'stem' })
  assert.equal(r.ok, true)
  assert.ok(r.warnings.some((w) => w.code === 'NUMBER_COUNT_DROPPED'))
})

test('题号被吞时报 NUMBER_COUNT_DROPPED', () => {
  const r = guardHtml({ sourceText: '1. 求f(1)', html: '<p>求$f(1)$</p>', field: 'stem' })
  assert.ok(r.warnings.some((w) => w.code === 'NUMBER_COUNT_DROPPED'))
})

test('数字出现次数一致时不产生警告', () => {
  const r = guardHtml({ sourceText: '2 和 2', html: '<p>2 和 2</p>', field: 'stem' })
  assert.deepEqual(r.warnings, [])
})

test('选项字母超过 H 也不漏（I、J）', () => {
  const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']
  const r = guardHtml({
    sourceText: letters.map((l, i) => `${l}.${i + 1}`).join(' '),
    html: letters.map((l, i) => `<p>${l}. ${i + 1}</p>`).join(''),
    field: 'stem'
  })
  assert.equal(r.ok, true, JSON.stringify(r.errors))
})

test('全角句点的选项能识别', () => {
  const r = guardHtml({
    sourceText: 'A．1 B．3 C．5 D．7',
    html: '<p>A. 1</p><p>B. 3</p><p>C. 5</p><p>D. 7</p>',
    field: 'stem'
  })
  assert.equal(r.ok, true, JSON.stringify(r.errors))
})

test('guard 结果带 warnings 字段（结构稳定）', () => {
  const r = guardHtml({ sourceText: '已知 x。', html: '<p>已知 $x$。</p>', field: 'stem' })
  assert.ok(Array.isArray(r.warnings))
  assert.deepEqual(r.warnings, [])
})

test('区间/坐标里的逗号是分隔符，不是千分位', () => {
  // 回归：把 [1,200] 当千分位读成 1200，模型在逗号后加空格（[1, 200]）就会误判成改数
  const pairs = [
    ['区间 x∈[1,200] 上单调', '<p>区间 $x\in[1, 200]$ 上单调</p>'],
    ['区间 x∈[1,200] 上单调', '<p>区间 $x\in[1,200]$ 上单调</p>'],
    ['点A(1,200)', '<p>点 $A(1, 200)$</p>'],
    ['集合{1,200}', '<p>集合 $\{1, 200\}$</p>']
  ]
  for (const [sourceText, html] of pairs) {
    const r = guardHtml({ sourceText, html, field: 'stem' })
    assert.deepEqual(r.errors, [], `${sourceText} → ${html} 误报`)
  }
})

test('真千分位仍然按同一个数比对', () => {
  const a = guardHtml({ sourceText: '标价1,200元', html: '<p>标价 1200 元</p>', field: 'stem' })
  assert.deepEqual(a.errors, [])
  const b = guardHtml({ sourceText: '标价1,200元', html: '<p>标价 1,200 元</p>', field: 'stem' })
  assert.deepEqual(b.errors, [])
})
