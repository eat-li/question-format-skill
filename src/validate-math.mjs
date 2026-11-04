// KaTeX 公式校验：逐段尝试渲染，收集失败清单。
//
// katex 是可选依赖（约 2MB），只有 verify 命令需要它——排版与修复路径不装 katex 也能跑。

/**
 * 逐段校验公式能否渲染。
 * @param {string} html
 * @returns {Promise<{ total: number, failed: { content: string, error: string }[] }>}
 */
export async function validateAiMath(html) {
  let katex
  try {
    katex = (await import('katex')).default
  } catch {
    const err = new Error(
      '公式校验需要 katex：请先执行 npm install（或 npm i katex），再用 verify 命令'
    )
    err.code = 'KATEX_MISSING'
    throw err
  }

  const failed = []
  let total = 0
  String(html || '').replace(/\$\$([\s\S]*?)\$\$|\$([^$\n<]+?)\$/g, (raw, d, i) => {
    total++
    const content = (d ?? i ?? '').trim()
    if (content) {
      try {
        katex.renderToString(content, { displayMode: Boolean(d), throwOnError: true, strict: false })
      } catch (e) {
        failed.push({ content, error: e?.message || '渲染失败' })
      }
    }
    return raw
  })
  return { total, failed }
}
