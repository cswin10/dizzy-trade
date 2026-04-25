#!/usr/bin/env node
// Bundler for the scanner Edge Function.
//
// We deploy Edge Functions through the Supabase dashboard, which only
// accepts a single TypeScript file. Source for the scanner is split
// across the entry point and several `_shared` helpers for sanity in
// development; this script flattens them into one self-contained file.
//
// Algorithm:
//   1. Parse import statements from the entry file.
//   2. Recursively process every relative import in dependency order
//      (children first), keeping a topological list of file bodies.
//   3. External imports (https://, npm:, jsr:, node:, bare specifiers)
//      are hoisted unchanged to the top of the bundle.
//   4. Each file's body has its `import` statements stripped and its
//      `export` keywords removed so all declarations sit at the top
//      level of the output module.
//   5. When two files declare the same top-level name (`const`, `let`,
//      `var`, `function`, `class`, `enum`, `type`, `interface`), the
//      second occurrence is renamed by suffixing the file basename and
//      every reference inside that file's body is rewritten.
//   6. Circular relative imports throw with a clear message.
//
// The original split files stay the source of truth. The bundled file
// is checked in as the deploy artefact so we can see exactly what was
// last pasted into the dashboard.

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, basename, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')
const ENTRY = resolve(REPO_ROOT, 'supabase/functions/scanner/index.ts')
const OUTPUT = resolve(REPO_ROOT, 'supabase/functions/scanner/index.bundled.ts')

function isRelativeImport(spec) {
  return spec.startsWith('./') || spec.startsWith('../')
}

function relPath(absPath) {
  return relative(REPO_ROOT, absPath).split('\\').join('/')
}

// Walks the source line by line and returns the byte ranges of every
// import statement, regardless of single or multi-line shape. Captures
// the imported specifier so the caller can decide whether to recurse
// or hoist.
function parseImports(source) {
  const lines = source.split('\n')
  const imports = []
  let i = 0
  while (i < lines.length) {
    const trimmed = lines[i].trimStart()
    if (trimmed.startsWith('import ') || trimmed === 'import') {
      let j = i
      let combined = ''
      let resolved = false
      while (j < lines.length) {
        combined += (j === i ? '' : '\n') + lines[j]
        const fromMatch = combined.match(/from\s*['"]([^'"]+)['"]\s*;?\s*$/)
        const bareMatch = combined.match(
          /^\s*import\s*['"]([^'"]+)['"]\s*;?\s*$/,
        )
        if (fromMatch) {
          imports.push({ startLine: i, endLine: j, spec: fromMatch[1] })
          resolved = true
          break
        }
        if (bareMatch) {
          imports.push({ startLine: i, endLine: j, spec: bareMatch[1] })
          resolved = true
          break
        }
        j++
      }
      i = (resolved ? j : i) + 1
    } else {
      i++
    }
  }
  return imports
}

function stripImportLines(source, imports) {
  const lines = source.split('\n')
  const remove = new Set()
  for (const r of imports) {
    for (let k = r.startLine; k <= r.endLine; k++) remove.add(k)
  }
  return lines.filter((_, idx) => !remove.has(idx)).join('\n')
}

function stripExportKeywords(source) {
  if (/^export\s+default\b/m.test(source)) {
    console.warn(
      '[bundler] warning: default export detected, may need manual handling',
    )
  }
  if (/^export\s+\*/m.test(source)) {
    console.warn(
      '[bundler] warning: re-export (export *) detected, may need manual handling',
    )
  }
  return source.replace(
    /^export\s+(type\b|interface\b|const\b|let\b|var\b|function\b|class\b|enum\b|abstract\b|async\b)/gm,
    '$1',
  )
}

function topLevelDeclaredNames(source) {
  const re =
    /^(?:export\s+)?(?:const|let|var|function|class|enum|interface|type|async\s+function)\s+([A-Za-z_$][\w$]*)/gm
  const names = []
  let m
  while ((m = re.exec(source)) !== null) names.push(m[1])
  return names
}

function renameInSource(source, oldName, newName) {
  return source.replace(new RegExp(`\\b${oldName}\\b`, 'g'), newName)
}

function suffixForFile(absPath) {
  return basename(absPath).replace(/\.tsx?$/, '')
}

async function processFile(absPath, state) {
  if (state.processed.has(absPath)) return
  if (state.processing.has(absPath)) {
    throw new Error(
      `circular relative import detected involving ${relPath(absPath)}`,
    )
  }
  state.processing.add(absPath)

  const source = await readFile(absPath, 'utf8')
  const imports = parseImports(source)

  for (const imp of imports) {
    if (isRelativeImport(imp.spec)) {
      const target = resolve(dirname(absPath), imp.spec)
      await processFile(target, state)
    } else {
      const lines = source.split('\n')
      const stmt = lines
        .slice(imp.startLine, imp.endLine + 1)
        .join('\n')
        .trim()
      state.externalImports.add(stmt)
    }
  }

  let body = stripExportKeywords(stripImportLines(source, imports))

  // Rename collisions before we add this file's names to the global
  // set. Only top-level declarations are checked; locals are scoped to
  // their function and don't conflict.
  const names = topLevelDeclaredNames(body)
  const suffix = suffixForFile(absPath)
  const counts = new Map()
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
  for (const [name, count] of counts.entries()) {
    if (count > 1) {
      console.warn(
        `[bundler] warning: name '${name}' declared ${count} times in ${relPath(absPath)}`,
      )
    }
  }
  for (const name of new Set(names)) {
    if (state.declared.has(name)) {
      const renamed = `${name}__${suffix}`
      console.warn(
        `[bundler] renaming '${name}' to '${renamed}' in ${relPath(absPath)}`,
      )
      body = renameInSource(body, name, renamed)
      state.declared.add(renamed)
    } else {
      state.declared.add(name)
    }
  }

  state.chunks.push({ file: relPath(absPath), body: body.trim() })
  state.processing.delete(absPath)
  state.processed.add(absPath)
}

async function main() {
  const state = {
    processed: new Set(),
    processing: new Set(),
    chunks: [],
    externalImports: new Set(),
    declared: new Set(),
  }

  await processFile(ENTRY, state)

  const headerLines = [
    '// AUTO-GENERATED. Do not edit. Run `npm run bundle:scanner` to regenerate.',
    `// Generated: ${new Date().toISOString()}`,
    '//',
    '// Source files (in dependency order):',
    ...state.chunks.map((c) => `//   ${c.file}`),
    '//',
    '// Paste this entire file into the Supabase dashboard scanner Edge',
    '// Function and click Deploy. The split files in supabase/functions/',
    '// remain the source of truth; this is just the deploy artefact.',
  ]
  const externals = [...state.externalImports].sort().join('\n')
  const body = state.chunks
    .map(
      (c) =>
        `// ---------------------------------------------------------------------\n// ${c.file}\n// ---------------------------------------------------------------------\n\n${c.body}\n`,
    )
    .join('\n')

  const output = `${headerLines.join('\n')}\n\n${externals}\n\n${body}\n`
  await writeFile(OUTPUT, output, 'utf8')
  console.log(
    `[bundler] wrote ${state.chunks.length} files into ${relPath(OUTPUT)}`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
