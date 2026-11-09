import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { boot, initProfile, readProfilePatches } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import * as plugin from '../src/index.js'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

test('native settings persist Bugwiki options and restore registered tools on fresh boot', { timeout: 15000 }, async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'bugwiki-settings-')))
  let ctx
  try {
    const dir = join(home, 'profiles', 'test')
    initProfile(dir, ['test-bundle'])
    const bundle = join(dir, 'node_modules', 'test-bundle')
    await mkdir(bundle, { recursive: true })
    await writeFile(join(home, 'package.json'), '{"name":"bugwiki-test-installation"}\n')
    await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
    await writeFile(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
      { id: 'config-editor', name: 'cordis:editor' }, { id: 'settings', name: 'cordis:settings' },
      { id: 'prompt', name: 'cordis:prompt' }, { id: 'tools', name: 'cordis:tools' },
      { id: 'executor', name: 'cordis:executor' }, { id: 'sessions', name: 'cordis:sessions' },
      { id: 'bugwiki', name: 'cordis:bugwiki', config: { wikiHome: home } },
    ] }]))
    await writeFile(join(dir, 'cordis.yml'), '[]\n')
    const profile = { name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [] }
    const start = () => boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), ctx => {
      ctx.provide('profileContext', profile)
      ctx.provide('sessionPersistence', { open: async () => { throw new Error('No historical fixture session') } })
      ctx.provide('appReady', { onReady: listener => { listener(); return () => {} } })
      Object.assign(ctx.loader.builtins, { editor: ConfigEditor, settings: Settings, prompt: SystemPrompt, tools: ToolRuntime, executor: NativeToolExecutor, sessions: SessionStore, bugwiki: plugin })
    })
    ctx = await start()
    const describe = () => ctx.settings.describe().find(row => row.ns === 'bugwiki')
    const fields = ['wikiHome', 'bashExecutable', 'pythonExecutable', 'pathPrefix', 'timeoutMs', 'maxOutputBytes', 'maxInputBytes', 'staleDays', 'archiveDays', 'lessonsMax', 'duplicateJaccard', 'duplicateMinPages', 'reportsKeep', 'factStaleDays', 'promotedStaleDays', 'prefix', 'suffix']
    const { schema } = describe()
    assert.deepEqual(Object.keys(schema.refs[schema.uid].dict).sort(), fields.sort())
    await ctx.settings.update('bugwiki', { prefix: 'SAVED_BUGWIKI_PREFIX', maxInputBytes: 1000 })
    const patch = await readFile(profile.patchPath, 'utf8')
    assert.match(patch, /SAVED_BUGWIKI_PREFIX/)
    await assert.rejects(ctx.settings.update('bugwiki', { maxInputBytes: 0 }))
    assert.equal(await readFile(profile.patchPath, 'utf8'), patch)
    await ctx.fiber.dispose()
    ctx = await start()
    assert.equal(describe().value.maxInputBytes, 1000)
    assert.match(renderPrompt(await ctx.systemPrompt.assemble()), /SAVED_BUGWIKI_PREFIX/)
    const tool = ctx.tools.get('bugwiki_export_dream')
    assert.ok(tool)
    await assert.rejects(tool.execute({ sessionIds: [] }, {}), /session/i)
    const session = ctx.sessions.create(SessionId('registered-export'), { meta: { cwd: home } })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Registered tool export' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    const result = await tool.execute({ sessionIds: [session.id] }, {})
    assert.equal(result.exitCode, 0, result.stderr)
    assert.equal(result.dryRun, true)
  } finally {
    if (ctx) await ctx.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  }
})
