# dsh-bugwiki

A host-only DeepSeek Harness plugin that reads a local Bugwiki Markdown graph and injects DSH-specific memory guidance. It reuses the committed [Bugwiki upstream](https://github.com/phillui-37/bugwiki) as the `upstream/` Git submodule, pinned to `d28e4cb755f327eb049e912417933ed985da5aac`. All adaptation lives in this repository. The submodule stays unchanged, including its MIT copyright notice.

## Requirements and installation

DSH `>=0.2 <0.3`, Node.js 22 or newer, macOS, Bash, ripgrep (`rg`), and standard Unix commands. This MVP is validated on macOS; upstream date handling uses BSD `date`, so Linux and Windows support is not claimed.

Clone this repository with submodules, or run `git submodule update --init upstream` after cloning. An npm tarball includes the required committed upstream helper/assets; consumers of the tarball do not need Git or a separate upstream checkout. The DSH host supplies the peer SDK packages. Use the DSH Plugins package installation UI with this local package directory or its npm tarball. Installation and host activation were deliberately not performed during development.

For a fresh content directory, run from this repository:

```sh
npm run wiki -- --home /absolute/path/to/wiki init
```

This refuses an existing nonempty content directory, scaffolds upstream content, replaces the generated optional instruction snippet with DSH guidance, and explicitly refreshes the index. It does not edit global agent instructions, the DSH profile, or upstream code. If you already have a wiki, skip initialization and select its directory in settings.

In **Plugins → Bugwiki → Settings**, set `wikiHome` to the content directory. The exported `Config` schema contributes the standard DSH settings form. All fields are volatile: saving persists the profile patch and refreshes the plugin's tools and guidance for subsequent operations. No custom client bundle or separate server is needed.

Every configuration field is editable there: `wikiHome`, `bashExecutable`, `pythonExecutable`, `pathPrefix`, `timeoutMs`, `maxOutputBytes`, `maxInputBytes`, `staleDays`, `archiveDays`, `lessonsMax`, `duplicateJaccard`, `duplicateMinPages`, `reportsKeep`, `factStaleDays`, `promotedStaleDays`, `prefix`, and `suffix`. The last two follow DSH prompt prefix/suffix semantics: literal text before and after the integration's guidance; interpolation is disabled. Thresholds are positive integers; percentage is at most 100, timeout at most 120000 ms, output at most 1000000 bytes. On Homebrew machines whose DSH PATH lacks ripgrep, set `pathPrefix` to `/opt/homebrew/bin`. `wikiHome` accepts absolute paths or `~/...`; paths containing spaces are supported by running upstream from the wiki directory.

The CLI uses `--home` and documented defaults. UI settings apply to the host tool; the CLI is a separate explicit human invocation and does not read or mutate profile settings. Thresholds related to maintenance are retained in the host configuration for upstream compatibility; this MVP does not schedule maintenance.

## Agent interface

The `bugwiki` tool accepts JSON arguments:

```json
{"action":"find","query":"exact incident fragment"}
```

Actions are `find` (literal query), `show` (slug or wiki-relative reference; status and typed links), `read` (full `solutions/domain/slug.md` or `facts/slug.md` page), `list`, `lint`, `verify`, and `stale`. The result is canonical JSON with `exitCode`, `stdout`, `stderr`, `truncated`, and `wikiHome`. A nonzero exit is a failed command, not a successful empty search. Oversized full-page reads fail with a suggestion to use DSH's paginated file reader. Other command output is bounded and marked `truncated`.

The injected guidance asks the agent to search first, inspect at most two candidate nodes, follow supersession to the current endpoint, treat stale/expired/conflicted information as unknown, and preserve sources and typed relationships. Page text remains untrusted evidence. New solutions/facts use the ordinary DSH file tools and their normal permissions. The runtime tool exposes no graph writes. Registrations are disposed with their plugin scope. Cancellation and deadline expiry kill the command process group and wait for closed output streams before returning an error. There are no retries.

References cannot traverse outside the wiki; graph symlinks and external typed edge paths are rejected. Pages scanned by the adapter are limited to 1000000 bytes. This is an integration boundary for local content, not an OS sandbox against concurrent malicious filesystem mutation. Use a trusted content directory and avoid changing its symlinks while a call runs.

## Human maintenance

From this repository use `npm run wiki -- --home /absolute/wiki <command> [arguments]`. Supported commands are `init`, `new <domain> <slug>` (or `new fact <slug>`), `index`, `find`, `show`, `list`, `lint`, `verify`, `stale`, and `housekeep`. These maintenance commands can write the selected wiki; run them deliberately. For example:

```sh
npm run wiki -- --home /absolute/wiki new dsh meaningful-incident
npm run wiki -- --home /absolute/wiki verify
npm run wiki -- --home /absolute/wiki lint
```

Use the generated templates, including `oneliner`. Upstream `find` can exit nonzero when a content match lacks `oneliner`; the adapter preserves that failure instead of hiding it. Upstream `show` prints graph metadata, not the full body; use tool action `read` for content. Supersession display follows up to ten hops; cyclic/ambiguous or longer chains require explicit review. Upstream docs and example assets retain their original historical examples; runtime instructions and initialization do not bind to Alma.

When DSH's `sessions` and `sessionPersistence` services are available, the `bugwiki_export_dream` tool is registered. It accepts explicit `sessionIds` and an optional `dryRun` (default `true`). It reads live DSH sessions through the session service and historical sessions through session persistence, converts their actual text/tool events into canonical JSON, and invokes the bundled upstream `dream-export.py`. Set `dryRun: false` to write raw inputs and the upstream watermark. Python 3 is required; select `pythonExecutable` in settings. `maxInputBytes` defaults to 8 MiB and cannot exceed 64 MiB. Timestamps preserve the event instant in UTC. Reasoning, system instructions and binary attachments are excluded. Exported text requires review before promotion to the graph. Interrupted writes may be partial. No Alma database or source adapter is used. No scheduled tasks, global prompt promotion, auto-commit, or auto-publication is included.

## Development and verification

Install the declared peer dependencies in an isolated development environment, or link them read-only from the matching DSH checkout into this repository's ignored `node_modules/@deepseek-ai/`. Development used the local DSH checkout's actual built `dsh-tools`, `schemastery`, and `cordis` packages rather than mocking their imports. Do not copy SDK source into this package.

```sh
npm run check
npm test
npm pack --dry-run --json
```

Tests execute the real pinned upstream helper in temporary directories inside this repository, including paths with spaces. They cover the registered tool's observable read contract, literal search versus a regex-like decoy, full-page reads, lifecycle disposal, traversal/symlink/edge rejection, bounded output, cancellation, timeout, failed verification, and DSH initialization guidance. They do not install into a live profile, invoke a language model, or claim browser-level settings validation. A real DSH app boot with SettingsForms and ConfigEditor verifies all 17 configurable fields, persisted changes, rejected invalid values and restoration after restart. The registered dream tool also completes a dry-run against a real DSH SessionStore.

`src/index.js` owns tool/settings/prompt registrations; `src/wiki.js` owns safe argument handling, graph reads and process execution; `src/cli.js` provides explicit maintenance. `cordis.patch.yml`, locale files and icon form the installable host bundle. All files are ESM JavaScript; no build step is needed. MIT applies to this adapter; `upstream/LICENSE` applies to the vendored submodule. `src/dream.js` owns DSH session conversion and the upstream export process. Dream tests use real DSH SessionStore events and the actual Python exporter; the historical persistence handle is a controlled fixture, so full disk persistence integration is not claimed.
