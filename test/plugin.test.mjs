import test from 'node:test'
import assert from 'node:assert/strict'

import { apply, inject, name } from '../lib/host.mjs'

/** 最小假 ctx：只实现本插件用到的两个服务，不依赖宿主包。 */
function makeCtx({ failTools = false, failSkills = false } = {}) {
  const tools = []
  const providers = []
  const warnings = []
  const ctx = {
    logger: { warn: (message) => warnings.push(message) },
    tools: {
      register(definition) {
        if (failTools) throw new Error('boom-tools')
        tools.push(definition)
        return () => {}
      }
    },
    skills: {
      registerProvider(create) {
        if (failSkills) throw new Error('boom-skills')
        providers.push(create({ signal: new AbortController().signal, invalidate() {} }))
        return () => {}
      }
    }
  }
  return { ctx, tools, providers, warnings }
}

test('插件声明 name 与 inject', () => {
  assert.equal(name, 'question-format')
  assert.deepEqual(inject, ['tools', 'skills'])
})

test('注册三个离线工具', () => {
  const { ctx, tools } = makeCtx()
  apply(ctx)
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['question_format_guard', 'question_format_repair', 'question_format_sanitize']
  )
})

test('每个工具都声明 output.schema 与 output.render', () => {
  const { ctx, tools } = makeCtx()
  apply(ctx)
  for (const tool of tools) {
    assert.equal(typeof tool.output.render, 'function', `${tool.name} 缺 render`)
    assert.equal(tool.output.schema.type, 'object', `${tool.name} 的输出 schema 必须是对象`)
    assert.ok(tool.timeoutMs > 0, `${tool.name} 必须有正的 timeoutMs`)
    assert.equal(tool.parameters.type, 'object')
    assert.equal(tool.parameters.additionalProperties, false)
  }
})

test('守卫工具：合规输出 ok，能删掉原文没有的答案', async () => {
  const { ctx, tools } = makeCtx()
  apply(ctx)
  const guard = tools.find((tool) => tool.name === 'question_format_guard')

  const good = await guard.execute({
    html: '<p>已知 $f(x)=x^{2}$，求 $f(3)$ 的值。</p><p>A. 1</p>',
    sourceText: '已知f(x)=x²，求f(3)的值。A.1'
  })
  assert.equal(good.ok, true, JSON.stringify(good.errors))
  assert.equal(good.errors.length, 0)

  const leak = await guard.execute({ html: '<p>求 $x$ 的值。</p><p>答案：4</p>', sourceText: '求x的值' })
  assert.equal(leak.removedAnswer, true)
  assert.ok(!leak.html.includes('答案'))
})

test('守卫工具：改坏数字会报错', async () => {
  const { ctx, tools } = makeCtx()
  apply(ctx)
  const guard = tools.find((tool) => tool.name === 'question_format_guard')
  const bad = await guard.execute({ html: '<p>已知 $f(x)=x^{2}$，求 $f(4)$ 的值。</p>', sourceText: '已知f(x)=x²，求f(3)的值' })
  assert.equal(bad.ok, false)
  assert.ok(bad.errors.some((error) => error.code === 'ADDED_NUMBER'), JSON.stringify(bad.errors))
})

test('守卫工具：空 html 直接抛错', async () => {
  const { ctx, tools } = makeCtx()
  apply(ctx)
  const guard = tools.find((tool) => tool.name === 'question_format_guard')
  await assert.rejects(() => guard.execute({ html: '   ' }), /html/)
})

test('修复工具：Unicode 公式转 LaTeX', async () => {
  const { ctx, tools } = makeCtx()
  apply(ctx)
  const repair = tools.find((tool) => tool.name === 'question_format_repair')
  const result = await repair.execute({ html: '<p>$∠A=30°$</p>' })
  assert.equal(result.changed, true)
  assert.equal(result.html, '<p>$\\angle A=30^\\circ$</p>')
})

test('消毒工具：去掉 script 与事件属性', async () => {
  const { ctx, tools } = makeCtx()
  apply(ctx)
  const sanitize = tools.find((tool) => tool.name === 'question_format_sanitize')
  const result = await sanitize.execute({ html: '<p onclick="steal()">正文</p><script>bad()</script>' })
  assert.equal(result.changed, true)
  assert.equal(result.html, '<p>正文</p>')
})

test('技能 provider：名字合法、可从 SKILL.md 读出正文与 resourceBase', async () => {
  const { ctx, providers } = makeCtx()
  apply(ctx)
  assert.equal(providers.length, 1)
  const provider = providers[0]
  assert.equal(provider.name, 'question-format-plugin')
  assert.notEqual(provider.name, 'runtime', 'provider 名不能占用保留名 runtime')

  const [candidate] = await provider.list()
  assert.equal(candidate.name, 'question-format')
  assert.match(candidate.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  assert.ok(candidate.description.length > 0)
  assert.equal(candidate.provider, 'question-format-plugin')
  assert.equal(typeof candidate.source, 'string')
  assert.equal(Number.isFinite(candidate.rank), true)
  assert.equal(candidate.invocation.modelInvocable, true)
  assert.equal(candidate.invocation.userInvocable, true)

  const definition = await provider.get(candidate)
  assert.equal(typeof definition.content, 'string')
  assert.ok(definition.content.length > 500, '正文太短，可能 frontmatter 没被正确剥离')
  assert.ok(!definition.content.startsWith('---'), '正文不应包含 frontmatter')
  assert.ok(definition.content.includes('题目排版'))
  assert.equal(definition.resourceBase.kind, 'directory')
  assert.ok(definition.resourceBase.path.length > 0)
})

test('工具注册失败时只告警，不影响技能注册', () => {
  const { ctx, providers, warnings } = makeCtx({ failTools: true })
  assert.doesNotThrow(() => apply(ctx))
  assert.equal(providers.length, 1)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /工具注册失败/)
})

test('技能注册失败时只告警，不影响工具注册', () => {
  const { ctx, tools, warnings } = makeCtx({ failSkills: true })
  assert.doesNotThrow(() => apply(ctx))
  assert.equal(tools.length, 3)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /技能注册失败/)
})
