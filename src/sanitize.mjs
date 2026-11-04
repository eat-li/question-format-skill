// HTML 白名单消毒：输出会进题库/预览页，模型可能带出 script、on* 或 javascript: 链接。
// 这里不做语义改写，只保留印刷题目需要的标签与图片属性。
//
// 允许的标签与 references/format-spec.md 第 2 节保持一致。

const ALLOWED = new Set([
  'p',
  'strong',
  'em',
  'u',
  'br',
  'ul',
  'ol',
  'li',
  'h2',
  'h3',
  'blockquote',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'code',
  'pre',
  'img'
])

const VOID = new Set(['br', 'img'])

// 这些标签连同内容一起删掉；<link>/<meta> 没有闭标签，只删标签本身
const DANGEROUS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'template',
  'noscript',
  'svg',
  'math',
  'link',
  'meta',
  'base'
])

const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g

function fromCodePointSafe(value) {
  const code = Number(value)
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => fromCodePointSafe(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => fromCodePointSafe(dec))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&colon;/gi, ':')
    .replace(/&newline;/gi, '\n')
    .replace(/&tab;/gi, '\t')
    .replace(/&amp;/gi, '&')
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function parseAttrs(raw) {
  const attrs = {}
  let match
  ATTR_RE.lastIndex = 0
  while ((match = ATTR_RE.exec(raw))) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? ''
  }
  return attrs
}

/** 只允许 http(s)、相对路径与常见位图 data URL；javascript:/vbscript:/data:text 一律丢弃 */
function safeUrl(value) {
  const url = String(value || '').trim()
  if (!url) return ''
  // 浏览器解析 URL 前会还原实体；先还原再判断，避免 &#106;avascript: 这类绕过
  const decoded = url
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => fromCodePointSafe(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => fromCodePointSafe(dec))
    .replace(/&colon;/gi, ':')
    .replace(/&newline;/gi, '\n')
    .replace(/&tab;/gi, '\t')
  // 浏览器会忽略 URL 里的换行/控制字符，先拒绝
  if (/[\u0000-\u001F\u007F\s]/.test(decoded) || decoded.includes('\\')) return ''
  if (/^https?:\/\//i.test(decoded)) return url
  if (/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(decoded)) return url
  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded)) return ''
  return url
}

function renderStart(name, attrText) {
  const attrs = parseAttrs(attrText)
  if (name === 'img') {
    const parts = []
    const src = safeUrl(decodeEntities(attrs.src))
    if (src) parts.push(`src="${escapeAttr(src)}"`)
    if (attrs.alt != null) parts.push(`alt="${escapeAttr(decodeEntities(attrs.alt))}"`)
    for (const key of ['width', 'height']) {
      if (/^\d{1,5}$/.test(attrs[key] || '')) parts.push(`${key}="${attrs[key]}"`)
    }
    return `<img${parts.length ? ' ' + parts.join(' ') : ''}>`
  }
  if (name === 'td' || name === 'th') {
    const parts = []
    for (const key of ['colspan', 'rowspan']) {
      if (/^\d{1,3}$/.test(attrs[key] || '')) parts.push(`${key}="${attrs[key]}"`)
    }
    return `<${name}${parts.length ? ' ' + parts.join(' ') : ''}>`
  }
  return `<${name}>`
}

/**
 * 读取一个标签 token；不是标签时返回 null（例如公式里的 x<0）。
 */
function readTag(src, start) {
  let i = start + 1
  let closing = false
  if (src[i] === '/') {
    closing = true
    i++
  }
  if (!/[a-zA-Z]/.test(src[i] || '')) return null

  let name = ''
  while (i < src.length && /[a-zA-Z0-9-]/.test(src[i])) name += src[i++]
  // 标签名后必须是空白、/ 或 >，否则 x<b$ 这类公式会被误当成标签
  if (i < src.length && !/[\s/>]/.test(src[i])) return null

  let quote = ''
  let end = i
  for (; end < src.length; end++) {
    const ch = src[end]
    if (quote) {
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '>') break
  }
  if (end >= src.length) return null

  const rawAttrs = src.slice(i, end)
  const selfClosing = /\/\s*$/.test(rawAttrs)
  return {
    name: name.toLowerCase(),
    closing,
    selfClosing,
    attrText: selfClosing ? rawAttrs.replace(/\/\s*$/, '') : rawAttrs,
    end: end + 1
  }
}

/**
 * 白名单消毒 HTML。
 * @param {string} html
 * @returns {string}
 */
export function sanitizeHtml(html) {
  const src = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')

  let out = ''
  const stack = []
  let i = 0

  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt < 0) {
      out += src.slice(i)
      break
    }
    out += src.slice(i, lt)

    const tag = readTag(src, lt)
    if (!tag) {
      out += '<'
      i = lt + 1
      continue
    }

    if (tag.closing) {
      if (ALLOWED.has(tag.name)) {
        const index = stack.lastIndexOf(tag.name)
        if (index >= 0) {
          while (stack.length > index) out += `</${stack.pop()}>`
        }
      }
      i = tag.end
      continue
    }

    if (DANGEROUS.has(tag.name)) {
      if (tag.selfClosing) {
        i = tag.end
        continue
      }
      const closeRe = new RegExp(`</${tag.name}\\s*>`, 'i')
      const match = closeRe.exec(src.slice(tag.end))
      // 没有闭合标签时只删标签，不吞掉后面的正文
      i = match ? tag.end + match.index + match[0].length : tag.end
      continue
    }

    if (!ALLOWED.has(tag.name)) {
      // 未知标签拆掉、保留文字
      i = tag.end
      continue
    }

    if (VOID.has(tag.name)) {
      out += renderStart(tag.name, tag.attrText)
      i = tag.end
      continue
    }

    if (tag.selfClosing) {
      out += `${renderStart(tag.name, tag.attrText)}</${tag.name}>`
      i = tag.end
      continue
    }

    out += renderStart(tag.name, tag.attrText)
    stack.push(tag.name)
    i = tag.end
  }

  while (stack.length) out += `</${stack.pop()}>`
  return out.trim()
}
