// 金样本：用真实题库里常见的脏输入验证「排版后能过守门」。
// 这些用例来自实际题目形态，不是为通过而编的例子——它们曾经抓到两个真 bug：
//   1. `…（　）A.5` 里 A 前是全角右括号，纯文本选项识别漏掉 A → 误报 ADDED_OPTION
//   2. `3.5万` 被改写成 `3.5\times 10^{4}` 时误报新增数字
import test from 'node:test'
import assert from 'node:assert/strict'
import { guardHtml } from '../src/guard.mjs'
import { normalizeAiMathHtml } from '../src/normalize-math.mjs'

/** 原文脏、输出规范的成对样本 */
const PAIRS = [
  {
    name: '一次函数 + 选项（选项紧跟全角括号）',
    source: '已知f(x)=2x+1，则f(3)的值为（　）A.5 B.6 C.7 D.8',
    html: '<p>已知 $f(x)=2x+1$，则 $f(3)$ 的值为（　）</p><p>A. 5</p><p>B. 6</p><p>C. 7</p><p>D. 8</p>'
  },
  {
    name: '几何题（Unicode 符号全部转命令）',
    source: '如图，△ABC中，∠A=30°，AB=2，AC=√3，求BC的长。',
    html: '<p>如图，$\\triangle ABC$ 中，$\\angle A=30^\\circ$，$AB=2$，$AC=\\sqrt{3}$，求 $BC$ 的长。</p>'
  },
  {
    name: '千分位被模型规整掉（不算改题）',
    source: '某商品标价1,200元，打八折后售价为（　）',
    html: '<p>某商品标价 1200 元，打八折后售价为（　）</p>'
  },
  {
    name: '区间与不等式',
    source: '若x∈[1,2]，则y=x+1的取值范围是（　）',
    html: '<p>若 $x\\in[1,2]$，则 $y=x+1$ 的取值范围是（　）</p>'
  },
  {
    name: '分数与根号混排',
    source: '化简：(√12 - √3) / 3 = （　）',
    html: '<p>化简：$\\dfrac{\\sqrt{12}-\\sqrt{3}}{3}=$（　）</p>'
  },
  {
    name: '带题号（题号必须留在原位）',
    source: '1. 求f(x)=x²在[0,1]上的最大值。',
    html: '<p>1. 求 $f(x)=x^{2}$ 在 $[0,1]$ 上的最大值。</p>'
  },
  {
    name: '九项多选题（I 不能漏）',
    source: '下列正确的是（　）A.1 B.2 C.3 D.4 E.5 F.6 G.7 H.8 I.9',
    html: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']
      .map((l, i) => `<p>${l}. ${i + 1}</p>`)
      .join('')
      .replace(/^/, '<p>下列正确的是（　）</p>')
  }
]

for (const sample of PAIRS) {
  test(`金样本通过守门：${sample.name}`, () => {
    const r = guardHtml({ sourceText: sample.source, html: sample.html, field: 'stem' })
    assert.equal(r.ok, true, `不应报错：${JSON.stringify(r.errors)}`)
    assert.deepEqual(r.errors, [])
  })
}

test('金样本：模型补写的答案与解析被删干净', () => {
  const source = '求f(x)=x²的最小值。'
  const html =
    '<p>求 $f(x)=x^{2}$ 的最小值。</p><p><strong>答案：</strong>0</p><p><strong>解析：</strong>$x^{2}\\ge 0$，故最小值为 0。</p>'
  const r = guardHtml({ sourceText: source, html, field: 'stem' })
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  assert.equal(r.removedAnswer, true)
  assert.equal(r.html, '<p>求 $f(x)=x^{2}$ 的最小值。</p>', '答案与解析两段都应被截掉')
  assert.doesNotMatch(r.html, /答案|解析/)
})

test('金样本：规范的排版不会被 guard 改动', () => {
  // guard 只该「清洗 + 检查」，对已经合规的输出必须是恒等变换
  const html = '<p>已知 $f(x)=2x+1$，则 $f(3)$ 的值为（　）</p><p>A. 5</p><p>B. 6</p>'
  const r = guardHtml({ sourceText: '已知f(x)=2x+1，则f(3)的值为（　）A.5 B.6', html, field: 'stem' })
  assert.equal(r.html, html)
  assert.equal(r.changed, false)
})

test('金样本：一批脏输入经 repair 后每条公式都能被解析', () => {
  const dirty = [
    '$∠A=30°$',
    '$x²≥0$',
    '$√(x+1)$',
    '$△ABC∽△DEF$',
    '$⌒AB$',
    '$∟ABC$',
    '$30°15″$',
    '$a≪b$'
  ]
  for (const one of dirty) {
    const out = normalizeAiMathHtml(one).html
    assert.doesNotMatch(out, /[²³√≥≤∠△∽⌒∟°″≪≫]/, `${one} 仍有未转换的 Unicode 数学符号：${out}`)
    assert.match(out, /^\$.*\$$/, `${one} 的定界符被破坏：${out}`)
  }
})
