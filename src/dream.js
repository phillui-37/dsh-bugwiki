import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { settings } from './wiki.js'

const exporter = fileURLToPath(new URL('../upstream/scripts/dream-export.py', import.meta.url))

function timestamp(time) {
  if (!Number.isSafeInteger(time)) throw new Error('DSH event timestamp must be epoch milliseconds')
  return new Date(time).toISOString()
}

function thread(id, header, events) {
  const names = new Map()
  const messages = []
  let title = id
  let updatedAt = header.createdAt
  for (const event of events) {
    updatedAt = Math.max(updatedAt, event.time)
    if (event.type === 'session/title') title = event.data.title
    const message = event.type === 'user/message' ? event.data
      : event.type === 'assistant/message' || event.type === 'tool/result' ? event.data.message : undefined
    if (!message || !['user', 'assistant', 'tool'].includes(message.role)) continue
    const content = []
    for (const block of message.content) {
      if (block.type === 'text') content.push({ type: 'text', text: block.text })
      if (block.type === 'tool-call') {
        names.set(block.id, block.name)
        content.push({ type: 'tool_call', name: block.name, input: block.arguments })
      }
    }
    if (message.role === 'tool') {
      messages.push({ role: 'tool', id: message.id, timestamp: timestamp(event.time), timezone: 'UTC', content: [{ type: 'tool_result', name: names.get(message.toolCallId) ?? message.toolCallId, output: content.map(part => part.text).join('\n') }] })
    } else if (content.length) {
      messages.push({ role: message.role, id: message.id, timestamp: timestamp(event.time), timezone: 'UTC', content })
    }
  }
  return { id, title, updatedAt: timestamp(updatedAt), messages }
}

function execute(config, ids, dryRun, input, signal) {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const argv = [exporter, '--input', '-', '--content-root', config.wikiHome]
    if (dryRun) argv.push('--dry-run')
    for (const id of ids) argv.push('--thread', id)
    const child = spawn(config.pythonExecutable, argv, { shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
    const output = { stdout: [], stderr: [] }
    let bytes = 0, truncated = false, failure
    const stop = error => {
      failure ??= error
      if (!child.pid) return
      if (process.platform === 'win32') child.kill('SIGKILL')
      else {
        try { process.kill(-child.pid, 'SIGKILL') }
        catch (error) { if (error.code !== 'ESRCH') child.kill('SIGKILL') }
      }
    }
    const abort = () => stop(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    for (const name of ['stdout', 'stderr']) child[name].on('data', chunk => {
      const remaining = Math.max(0, config.maxOutputBytes - bytes)
      if (remaining) output[name].push(chunk.subarray(0, remaining))
      bytes += chunk.length
      truncated ||= bytes > config.maxOutputBytes
    })
    child.once('error', error => { failure ??= error })
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') stop(error) })
    child.once('close', code => {
      signal.removeEventListener('abort', abort)
      if (failure) return reject(failure)
      const decode = chunks => new TextDecoder().decode(Buffer.concat(chunks), { stream: truncated })
      resolve({ exitCode: code ?? -1, stdout: decode(output.stdout), stderr: decode(output.stderr), truncated, wikiHome: config.wikiHome, dryRun, sessionIds: ids })
    })
    child.stdin.end(input)
  })
}

/**
 * Export explicitly selected DSH session logs using the bundled upstream exporter.
 * Reasoning, instructions and binary attachments are excluded. Event times are UTC.
 * @param {object} ctx DSH context with sessions and sessionPersistence services.
 * @param {object} input Plugin configuration, including pythonExecutable and maxInputBytes.
 * @param {object} args Explicit sessionIds and optional dryRun (defaults to true).
 * @param {object} options Optional caller AbortSignal.
 * @returns {Promise<object>} Bounded process output and export selection; nonzero exits remain visible.
 */
export async function exportDream(ctx, input, args, { signal: callerSignal } = {}) {
  const config = { ...settings(input), pythonExecutable: input?.pythonExecutable ?? 'python3', maxInputBytes: input?.maxInputBytes ?? 8 * 1024 * 1024 }
  if (typeof config.pythonExecutable !== 'string' || !config.pythonExecutable || config.pythonExecutable.includes('\0')) throw new Error('pythonExecutable must be a nonempty executable name or path without NUL')
  if (!Number.isSafeInteger(config.maxInputBytes) || config.maxInputBytes < 1 || config.maxInputBytes > 64 * 1024 * 1024) throw new Error('maxInputBytes must be between 1 and 67108864')
  if (!Array.isArray(args?.sessionIds) || !args.sessionIds.length || args.sessionIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9._-]+$/.test(id) || id.startsWith('-'))) throw new Error('sessionIds must contain explicit DSH session IDs')
  if (args.dryRun !== undefined && typeof args.dryRun !== 'boolean') throw new Error('dryRun must be a boolean')
  const ids = [...new Set(args.sessionIds)]
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`Dream export timed out after ${config.timeoutMs}ms; outcome unknown`)), config.timeoutMs)
  const signal = AbortSignal.any([controller.signal, ...(callerSignal ? [callerSignal] : [])])
  try {
    signal.throwIfAborted()
    const threads = []
    let bytes = Buffer.byteLength('{"threads":[]}')
    for (const id of ids) {
      signal.throwIfAborted()
      const live = ctx.sessions.get(id)
      let value
      if (live) {
        value = thread(id, live.header, live.snapshotEvents())
      } else {
        const handle = await ctx.sessionPersistence.open(id, 'read', { signal })
        if (!handle) throw new Error(`DSH session not found: ${id}`)
        try {
          const { events } = await handle.read(0, undefined, { signal })
          value = thread(id, handle.header, events)
        } finally { await handle.close() }
      }
      bytes += Buffer.byteLength(JSON.stringify(value)) + (threads.length ? 1 : 0)
      if (bytes > config.maxInputBytes) throw new Error('Dream export exceeds maxInputBytes; select fewer sessions')
      threads.push(value)
    }
    return await execute(config, ids, args.dryRun ?? true, JSON.stringify({ threads }), signal)
  } finally { clearTimeout(timer) }
}
