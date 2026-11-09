import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage, createAssistantMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { exportDream } from '../src/dream.js'

async function fixture(t) {
  const wikiHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-dream-'))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  t.after(async () => { await ctx.fiber.dispose(); await rm(wikiHome, { recursive: true, force: true }) })
  const session = ctx.sessions.create(SessionId('dream-session'), { meta: { createdAt: 1700000000000, cwd: wikiHome } })
  session.append('session/title', { title: 'DSH export', messageSeqs: [], source: { kind: 'user' } })
  const user = createUserMessage({ content: [{ type: 'text', text: 'Remember café 漢字' }], source: { kind: 'user' } })
  session.append('user/message', user, { surfaceOp: 'append' })
  const assistant = createAssistantMessage({ content: [{ type: 'reasoning', text: 'private reasoning' }, { type: 'text', text: 'Visible response' }, { type: 'tool-call', id: 'call-one', name: 'lookup', arguments: '{"query":"café"}' }], source: { provider: 'test', model: 'test' } })
  session.append('assistant/message', { turn: 0, step: 0, message: assistant, stream: [] }, { surfaceOp: 'append' })
  session.append('tool/result', { turn: 0, step: 0, message: createToolResultMessage({ callId: 'call-one', content: [{ type: 'text', text: 'Tool answer' }], isError: false }) }, { surfaceOp: 'append' })
  return { ctx, session, user, wikiHome }
}

async function exportedText(root) {
  const [day] = await readdir(path.join(root, '.raw'))
  const [name] = await readdir(path.join(root, '.raw', day))
  return readFile(path.join(root, '.raw', day, name), 'utf8')
}

test('real DSH SessionStore exports through upstream Python, dry-run by default', async t => {
  const { ctx, session, user, wikiHome } = await fixture(t)
  const preview = await exportDream(ctx, { wikiHome }, { sessionIds: [session.id] })
  assert.equal(preview.exitCode, 0, preview.stderr)
  assert.equal(preview.dryRun, true)
  assert.deepEqual(await readdir(wikiHome), [])
  const result = await exportDream(ctx, { wikiHome }, { sessionIds: [session.id, session.id], dryRun: false })
  assert.equal(result.exitCode, 0, result.stderr)
  assert.deepEqual(result.sessionIds, [session.id])
  const text = await exportedText(wikiHome)
  assert.match(text, /Remember café 漢字/)
  assert.match(text, /Visible response/)
  assert.match(text, /lookup/)
  assert.match(text, /Tool answer/)
  assert.ok(text.includes(user.id))
  assert.ok(text.includes(new Date(session.snapshotEvents().find(event => event.type === 'user/message').time).toISOString()))
  assert.match(text, /UTC/)
  assert.doesNotMatch(text, /private reasoning/)
})

test('historical sessions use persistence read and close the handle', async t => {
  const { session, wikiHome } = await fixture(t)
  let closed = 0
  const ctx = { sessions: { get: () => undefined }, sessionPersistence: { open: async (id, mode, options) => {
    assert.equal(id, session.id)
    assert.equal(mode, 'read')
    assert.ok(options.signal instanceof AbortSignal)
    return { header: session.header, read: async (from, end) => {
      assert.equal(from, 0)
      assert.equal(end, undefined)
      return { events: session.snapshotEvents() }
    }, close: async () => { closed++ } }
  } } }
  const result = await exportDream(ctx, { wikiHome }, { sessionIds: [session.id], dryRun: false })
  assert.equal(result.exitCode, 0, result.stderr)
  assert.equal(closed, 1)
  assert.match(await exportedText(wikiHome), /Tool answer/)
  ctx.sessionPersistence.open = async () => ({ header: session.header, read: async () => { throw new Error('storage read failed') }, close: async () => { closed++ } })
  await assert.rejects(exportDream(ctx, { wikiHome }, { sessionIds: [session.id] }), /storage read failed/)
  assert.equal(closed, 2)
})

test('selection and byte limits reject before writing; Python failures stay visible', async t => {
  const { ctx, session, wikiHome } = await fixture(t)
  await assert.rejects(exportDream(ctx, { wikiHome }, {}), /explicit DSH session IDs/)
  await assert.rejects(exportDream(ctx, { wikiHome }, { sessionIds: ['--help'] }), /explicit DSH session IDs/)
  await assert.rejects(exportDream(ctx, { wikiHome, maxInputBytes: 1 }, { sessionIds: [session.id], dryRun: false }), /maxInputBytes/)
  assert.deepEqual(await readdir(wikiHome), [])
  const bounded = await exportDream(ctx, { wikiHome, maxOutputBytes: 5 }, { sessionIds: [session.id] })
  assert.equal(bounded.exitCode, 0)
  assert.equal(bounded.truncated, true)
  assert.ok(Buffer.byteLength(bounded.stdout) + Buffer.byteLength(bounded.stderr) <= 5)
  await assert.rejects(exportDream(ctx, { wikiHome, pythonExecutable: path.join(wikiHome, 'missing-python') }, { sessionIds: [session.id] }), /ENOENT/)
})

test('caller cancellation and operation deadline terminate the real child', async t => {
  const { ctx, session, wikiHome } = await fixture(t)
  const controller = new AbortController()
  controller.abort(new Error('caller stopped'))
  await assert.rejects(exportDream(ctx, { wikiHome }, { sessionIds: [session.id] }, { signal: controller.signal }), /caller stopped/)
  const running = new AbortController()
  const pending = exportDream(ctx, { wikiHome }, { sessionIds: [session.id] }, { signal: running.signal })
  running.abort(new Error('cancel running child'))
  await assert.rejects(pending, /cancel running child/)
  // The deadline covers Python startup as well as export work.
  await assert.rejects(exportDream(ctx, { wikiHome, timeoutMs: 1 }, { sessionIds: [session.id] }), /timed out/)
  assert.deepEqual(await readdir(wikiHome), [])
})
