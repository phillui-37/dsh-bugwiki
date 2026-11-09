#!/usr/bin/env node
import { execute, guidance, settings } from './wiki.js'
import { writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const homeFlag = args.indexOf('--home')
let wikiHome
if (homeFlag !== -1) {
  wikiHome = args[homeFlag + 1]
  if (!wikiHome) throw new Error('--home requires a directory')
  args.splice(homeFlag, 2)
}
const [command, ...rest] = args
if (!['init', 'find', 'show', 'new', 'index', 'lint', 'verify', 'stale', 'list', 'housekeep'].includes(command)) {
  console.error('Usage: npm run wiki -- --home /absolute/wiki <init|find|show|new|index|lint|verify|stale|list|housekeep> [arguments]\nManual maintenance only. No Alma adapter or dream export.')
  process.exitCode = 2
} else {
  const config = settings(wikiHome ? { wikiHome } : {})
  if (command === 'init' && rest.length) throw new Error('Use --home for the init destination')
  if (command === 'init') {
    try {
      if ((await readdir(config.wikiHome)).length) throw new Error('Refusing to initialize a nonempty wiki directory')
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const result = await execute(config, command === 'init' ? ['init', config.wikiHome] : args)
  if (command === 'init' && result.exitCode === 0) {
    await writeFile(path.join(config.wikiHome, 'AGENTS-snippet.md'), guidance(config) + '\n', 'utf8')
    const indexed = await execute(config, ['index'])
    process.stdout.write(indexed.stdout)
    process.stderr.write(indexed.stderr)
    console.log(`Wiki initialized at ${config.wikiHome}. Configure wikiHome in Plugins → Bugwiki settings. The plugin injects DSH guidance; no global prompt edit is required.`)
    process.exitCode = indexed.exitCode
  } else {
    process.stdout.write(result.stdout)
    process.stderr.write(result.stderr)
    process.exitCode = result.exitCode
  }
  if (result.truncated) console.error('\nOutput truncated; inspect the wiki directly.')
}
