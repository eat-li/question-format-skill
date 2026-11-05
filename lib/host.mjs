/**
 * dsh 插件宿主：把 question-format 能力挂进 DeepSeek Harness。
 *
 * 这一层是「纯 Node 半侧」——不 import 任何 @deepseek-ai/* 运行时包，
 * 只通过 ctx.tools / ctx.skills 这两个由宿主注入的服务工作，
 * 因此不需要双端构建，也不受宿主版本兼容检查影响。
 *
 * 提供两样东西：
 *   1. 三个离线工具（守门 / 公式修复 / 消毒），零网络、零 API Key；
 *   2. 一个 question-format 技能，正文取包内 SKILL.md，
 *      resourceBase 指向包根，所以 SKILL.md 里的 references/*.md 相对路径可用。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { guardHtml } from '../src/guard.mjs'
import { normalizeAiMathHtml } from '../src/normalize-math.mjs'
import { sanitizeHtml } from '../src/sanitize.mjs'

export const name = 'question-format'

/** tools 提供工具注册，skills 提供技能注册；缺任何一个本插件不启动。 */
export const inject = ['tools', 'skills']

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SKILL_FILE = join(PACKAGE_ROOT, 'SKILL.md')

/** 技能 provider 名，不能是保留名 "runtime"。 */
const PROVIDER = 'question-format-plugin'
/**
 * 技能优先级：数值越小越优先。
 * 450 落在「用户自建技能」（~/.dsh/skills，400）之后，
 * 即用户自己放了同名 SKILL.md 时以用户的为准。
 */
const SKILL_RANK = 450

const FIELD_VALUES = ['auto', 'stem', 'body', 'answer']

const ERROR_ITEM = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'message'],
  properties: {
    code: { type: 'string', description: '错误码，如 ADDED_NUMBER / LOST_OPTION / BARE_DOLLAR' },
    message: { type: 'string', description: '给人看的中文说明' }
  }
}

const GUARD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'field', 'html', 'changed', 'removedAnswer', 'fixes', 'errors', 'warnings'],
  properties: {
    ok: { type: 'boolean', description: 'errors 为空时为 true，可以直接交付' },
    field: { type: 'string', description: '本次按哪个字段身份检查' },
    html: { type: 'string', description: '清洗与修复后的 HTML（可直接落库）' },
    changed: { type: 'boolean', description: 'html 与输入相比是否被改动' },
    removedAnswer: { type: 'boolean', description: '是否删掉了原文没有的答案解析' },
    fixes: { type: 'array', items: { type: 'string' }, description: '自动做过的修复动作' },
    errors: { type: 'array', items: ERROR_ITEM, description: '必须修的问题，有则不可交付' },
    warnings: {
      type: 'array',
      items: ERROR_ITEM,
      description: '提示项（如数字出现次数变少），不影响交付'
    }
  }
}

const REPAIR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['html', 'changed'],
  properties: {
    html: { type: 'string', description: '修好公式的 HTML' },
    changed: { type: 'boolean', description: '是否发生了改动' }
  }
}

const SANITIZE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['html', 'changed'],
  properties: {
    html: { type: 'string', description: '白名单过滤后的 HTML' },
    changed: { type: 'boolean', description: '是否发生了改动' }
  }
}

function text(value) {
  return [{ type: 'text', text: value }]
}

function renderGuard(_args, value) {
  const lines = []
  lines.push(value.ok ? '✅ 守卫通过，可以交付。' : `❌ 守卫发现 ${value.errors.length} 个必须修的问题。`)
  if (value.field) lines.push(`字段身份：${value.field}`)
  if (value.removedAnswer) lines.push('已删除原文没有的答案解析（防泄题兜底）')
  if (value.fixes?.length) lines.push(`自动修复：${value.fixes.join('、')}`)
  for (const error of value.errors ?? []) lines.push(`· 错误 ${error.code} — ${error.message}`)
  for (const warning of value.warnings ?? []) lines.push(`· 提示 ${warning.code} — ${warning.message}`)
  lines.push('', 'HTML：', value.html)
  return lines.join('\n')
}

function renderRepair(_args, value) {
  return value.changed ? `已修公式：\n\n${value.html}` : `公式已经是规范写法，无需改动。\n\n${value.html}`
}

function renderSanitize(_args, value) {
  return value.changed ? `已消毒（去掉了白名单外的标签/属性）：\n\n${value.html}` : `没有需要清除的内容。\n\n${value.html}`
}

/** 拆 SKILL.md 的 frontmatter，返回 name / description / 正文。 */
function readSkill() {
  const raw = readFileSync(SKILL_FILE, 'utf8')
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(raw)
  let skillName = 'question-format'
  let description = '把数学题目整理成规范 HTML，内置防泄题与数字/选项守恒守卫。'
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const pair = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(line)
      if (!pair) continue
      const key = pair[1]
      const value = pair[2].trim()
      if (key === 'name' && value) skillName = value
      else if (key === 'description' && value) description = value
    }
  }
  return {
    name: skillName,
    description,
    content: (match ? raw.slice(match[0].length) : raw).trim()
  }
}

function registerTools(ctx) {
  ctx.tools.register({
    name: 'question_format_guard',
    description: [
      '数学题排版的确定性守门：检查一份 HTML 是否把题目改坏了。',
      '自动做 Unicode 公式归一、命令补空格、标签配平、防泄题删答案，然后比对原文与输出的数字与选项是否守恒、有没有裸 $、残留 Unicode 数学符号、危险标签或内联样式。',
      '用于「检查/校验排版结果」「这道题有没有被改坏」「交付前自检」「确认没有泄题」，',
      '也可以直接当作清洗器使用：把模型产出的脏 HTML 丢进来，拿返回的 html 落库。',
      '全程离线，不需要 API Key。'
    ].join(''),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['html'],
      properties: {
        html: { type: 'string', description: '待检查的 HTML（可以是脏的，会先清洗再检查）' },
        sourceText: {
          type: 'string',
          description: '用户原文。给了才会做防泄题、数字守恒、选项守恒检查；不给则只做格式与安全体检。'
        },
        field: {
          type: 'string',
          enum: FIELD_VALUES,
          default: 'auto',
          description: '字段身份：auto 按原文推断，stem 题干（不许出现答案），body 正文，answer 答案（允许答案）'
        },
        sanitize: {
          type: 'boolean',
          default: false,
          description: '是否顺手做白名单消毒（只保留 p/strong/em/br/ul/ol/li/table/img 等）'
        }
      }
    },
    output: { schema: GUARD_SCHEMA, render: renderGuard },
    timeoutMs: 60_000,
    isConcurrencySafe: () => true,
    presentCall: (args) => ({
      card: 'generic',
      title: '题目排版守卫',
      kind: 'execute',
      rawInput: {
        field: args.field ?? 'auto',
        sanitize: args.sanitize === true,
        hasSource: typeof args.sourceText === 'string' && args.sourceText.length > 0
      }
    }),
    async execute(args) {
      const html = String(args.html ?? '')
      if (!html.trim()) throw new Error('Provide `html`: 要检查的 HTML 不能为空')
      const result = guardHtml({
        html,
        sourceText: typeof args.sourceText === 'string' ? args.sourceText : '',
        field: args.field ?? 'auto',
        sanitize: args.sanitize === true
      })
      return {
        ok: result.errors.length === 0,
        field: result.field,
        html: result.html,
        changed: result.changed,
        removedAnswer: result.removedAnswer,
        fixes: result.fixes,
        errors: result.errors,
        warnings: result.warnings
      }
    }
  })

  ctx.tools.register({
    name: 'question_format_repair',
    description: [
      '离线修复 HTML 里的数学公式写法：Unicode 数学符号（² √ ≥ α ∠ △）转 LaTeX、',
      '\\( \\) / \\[ \\] 定界符转 $ / $$、补 LaTeX 命令与后面字母之间的空格（\\angle A）、去掉 HTML 标签外散落的文本。',
      '用于「公式渲染不出来」「KaTeX 报错」「这个符号不认识」「把公式改成能渲染的写法」。',
      '不改动题目文字、数字与选项，只动公式写法。不需要 API Key。'
    ].join(''),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['html'],
      properties: {
        html: { type: 'string', description: '含公式的 HTML' }
      }
    },
    output: { schema: REPAIR_SCHEMA, render: renderRepair },
    timeoutMs: 30_000,
    isConcurrencySafe: () => true,
    presentCall: () => ({ card: 'generic', title: '公式修复', kind: 'execute', rawInput: {} }),
    async execute(args) {
      const html = String(args.html ?? '')
      if (!html.trim()) throw new Error('Provide `html`: 要修复的 HTML 不能为空')
      const result = normalizeAiMathHtml(html)
      return { html: result.html, changed: result.changed }
    }
  })

  ctx.tools.register({
    name: 'question_format_sanitize',
    description: [
      '按白名单消毒一段 HTML：只保留 p / strong / em / u / br / ul / ol / li / h2 / h3 / blockquote / table / code / pre / img，',
      '删掉 script、style、iframe、form、svg 等危险标签（连内容一起删），去掉 on* 事件、inline style、javascript: 链接。',
      '用于「这段 HTML 能直接落库吗」「去掉富文本编辑器带进来的垃圾标签」。离线执行。'
    ].join(''),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['html'],
      properties: {
        html: { type: 'string', description: '待消毒的 HTML' }
      }
    },
    output: { schema: SANITIZE_SCHEMA, render: renderSanitize },
    timeoutMs: 30_000,
    isConcurrencySafe: () => true,
    presentCall: () => ({ card: 'generic', title: 'HTML 消毒', kind: 'execute', rawInput: {} }),
    async execute(args) {
      const html = String(args.html ?? '')
      if (!html.trim()) throw new Error('Provide `html`: 要消毒的 HTML 不能为空')
      const safe = sanitizeHtml(html)
      return { html: safe, changed: safe !== html }
    }
  })
}

function registerSkill(ctx) {
  ctx.skills.registerProvider((control) => {
    let cached
    const load = () => {
      if (!cached) cached = readSkill()
      return cached
    }
    const candidate = () => {
      const skill = load()
      return {
        name: skill.name,
        description: skill.description,
        invocation: { modelInvocable: true, userInvocable: true },
        provider: PROVIDER,
        source: 'question-format-plugin',
        rank: SKILL_RANK,
        path: SKILL_FILE,
        resourceBase: { kind: 'directory', path: PACKAGE_ROOT }
      }
    }
    return {
      name: PROVIDER,
      async list() {
        if (control.signal.aborted) return []
        return [candidate()]
      },
      async get() {
        const skill = load()
        return { ...candidate(), name: skill.name, description: skill.description, content: skill.content }
      }
    }
  })
}

/**
 * 插件入口。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  try {
    registerTools(ctx)
  } catch (error) {
    ctx.logger?.warn?.(`[question-format] 工具注册失败：${error?.message ?? error}`)
  }
  try {
    registerSkill(ctx)
  } catch (error) {
    ctx.logger?.warn?.(`[question-format] 技能注册失败：${error?.message ?? error}`)
  }
}
