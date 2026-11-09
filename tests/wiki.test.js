import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaults, execute, runWiki, settings } from '../src/wiki.js'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import * as plugin from '../src/index.js'

const repo = fileURLToPath(new URL('../', import.meta.url))
const temporary = path.join(repo, '.test-tmp')
await mkdir(temporary, { recursive: true })
async function fixture(t) {
  const dir = await mkdtemp(path.join(temporary, 'wiki with spaces-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  execFileSync(process.execPath, [path.join(repo, 'src/cli.js'), '--home', dir, 'init'], { timeout: 10000 })
  return dir
}
function page(title, extra = '') {
  return `---\ntitle: ${title}\noneliner: ${title}\nstatus: verified\n${extra}---\n\n# ${title}\ntraceable body\n`
}

test('real upstream init, literal find, status links and full-page read through registered DSH tool', async t => {
  const dir = await fixture(t)
  await mkdir(path.join(dir, 'solutions', 'dsh'))
  await writeFile(path.join(dir, 'solutions/dsh/example.md'), page('literal.*incident'))
  await writeFile(path.join(dir, 'solutions/dsh/decoy.md'), page('literalXXincident'))
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(Loader)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  ctx.loader.builtins.bugwiki = plugin
  const config = { wikiHome: dir, prefix: 'CUSTOM PREFIX', suffix: 'CUSTOM SUFFIX' }
  const id = await ctx.loader.create({ name: 'cordis:bugwiki', config })
  const entry = ctx.loader.resolve(id)
  await entry.fiber.await()
  let tool = ctx.tools.get('bugwiki')
  assert.equal(tool.name, 'bugwiki')
  await assert.rejects(tool.execute({ action: 'new' }, {}))
  const prompt = renderPrompt(await ctx.systemPrompt.assemble())
  assert.match(prompt, /CUSTOM PREFIX/)
  assert.match(prompt, /CUSTOM SUFFIX/)
  const result = await tool.execute({ action: 'find', query: 'literal.*incident' }, { signal: new AbortController().signal })
  assert.equal(result.exitCode, 0, result.stderr)
  assert.match(result.stdout, /example/)
  assert.doesNotMatch(result.stdout, /decoy/)
  const show = await tool.execute({ action: 'show', ref: 'solutions/dsh/example.md' }, {})
  assert.equal(show.exitCode, 0, show.stderr)
  const read = await tool.execute({ action: 'read', ref: 'solutions/dsh/example.md' }, {})
  assert.match(read.stdout, /traceable body/)
  assert.doesNotThrow(() => tool.output.render({ action: 'read' }, read))
  const instructions = await readFile(path.join(dir, 'AGENTS-snippet.md'), 'utf8')
  assert.match(instructions, /DSH/)
  assert.throws(() => execFileSync(process.execPath, [path.join(repo, 'src/cli.js'), '--home', dir, 'init'], { timeout: 10000, stdio: 'pipe' }), /nonempty wiki directory/)
  assert.equal(await readFile(path.join(dir, 'AGENTS-snippet.md'), 'utf8'), instructions)
  await entry.update({ config: { ...config, prefix: 'UPDATED PREFIX', maxOutputBytes: 8 } })
  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000
    const timer = setInterval(async () => {
      try {
        if (renderPrompt(await ctx.systemPrompt.assemble()).includes('UPDATED PREFIX')) { clearInterval(timer); resolve() }
        else if (Date.now() > deadline) { clearInterval(timer); reject(new Error('live settings did not settle')) }
      } catch (error) { clearInterval(timer); reject(error) }
    }, 20)
  })
  tool = ctx.tools.get('bugwiki')
  const updated = await tool.execute({ action: 'list' }, {})
  assert.equal(updated.truncated, true)
  assert.ok(Buffer.byteLength(updated.stdout + updated.stderr) <= 8)
  await ctx.fiber.dispose()
  assert.equal(ctx.tools, undefined)
})

test('read-only contract rejects mutations, traversal, redirected pages and external graph edges', async t => {
  const dir = await fixture(t)
  await assert.rejects(runWiki({ wikiHome: dir }, { action: 'new' }), /Unsupported/)
  await assert.rejects(runWiki({ wikiHome: dir }, { action: 'read', ref: '../package.json' }), /traversal/)
  const pagePath = path.join(dir, 'facts/escape.md')
  await symlink(path.join(repo, 'package.json'), pagePath)
  await assert.rejects(runWiki({ wikiHome: dir }, { action: 'list' }), /symlinks/)
  await rm(pagePath)
  await writeFile(path.join(dir, 'facts/target.md'), page('target'))
  await writeFile(pagePath, page('escape', 'related: [../facts/target.md]\n'))
  const linked = await runWiki({ wikiHome: dir }, { action: 'show', ref: 'facts/escape.md' })
  assert.equal(linked.exitCode, 0)
  assert.match(linked.stdout, /target/)
  await writeFile(pagePath, page('escape', 'related: [../../outside.md]\n'))
  await assert.rejects(runWiki({ wikiHome: dir }, { action: 'list' }), /escapes wikiHome/)
  await writeFile(pagePath, page('escape', 'supersedes: [/etc/passwd]\n'))
  await assert.rejects(runWiki({ wikiHome: dir }, { action: 'show', ref: 'facts/escape.md' }), /relative reference/)
})

test('bounds, diagnostics, cancellation and process-group timeout are observable', async t => {
  const dir = await fixture(t)
  const config = settings({ wikiHome: dir, maxOutputBytes: 16 })
  const result = await execute(config, ['list'])
  assert.equal(typeof result.exitCode, 'number')
  await writeFile(path.join(dir, 'facts/' + 'large'.repeat(20) + '.md'), page('large'))
  const limited = await runWiki(config, { action: 'list' })
  assert.equal(limited.truncated, true)
  assert.ok(Buffer.byteLength(limited.stdout + limited.stderr) <= 16)
  const aborted = AbortSignal.abort(new Error('cancelled fixture'))
  await assert.rejects(runWiki({ wikiHome: dir }, { action: 'list' }, { signal: aborted }), /cancelled fixture/)
  const emitter = path.join(dir, 'emitter-bash')
  await writeFile(emitter, '#!/bin/bash\nprintf "中文內容"\n', { mode: 0o755 })
  const unicode = await execute(settings({ wikiHome: dir, bashExecutable: emitter, maxOutputBytes: 4 }), ['list'])
  assert.equal(unicode.stdout, '中')
  assert.equal(unicode.truncated, true)
  const slow = path.join(dir, 'slow-bash')
  await writeFile(slow, '#!/bin/bash\nsleep 20\n', { mode: 0o755 })
  await assert.rejects(execute(settings({ wikiHome: dir, bashExecutable: slow, timeoutMs: 50 }), ['list']), /timed out/)
  await writeFile(path.join(dir, 'facts/broken.md'), 'missing frontmatter\n')
  const broken = await runWiki({ wikiHome: dir }, { action: 'verify' })
  assert.notEqual(broken.exitCode, 0)
  assert.match(broken.stdout, /FAILED/)
})
