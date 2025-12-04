import React, { useMemo } from 'react'

interface SQLInputProps {
  value: string
  onChange: (v: string) => void
  rows?: number
}

function escapeHtml(str: string) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function highlightSQL(sql: string) {
  let s = escapeHtml(sql)
  // Strings
  s = s.replace(/'(?:''|[^'])*'/g, (m) => `<span class="text-pink-300">${m}</span>`) 
  // Comments -- and /* */
  s = s.replace(/--.*$/gm, (m) => `<span class="text-white/40">${m}</span>`)
  s = s.replace(/\/\*[\s\S]*?\*\//g, (m) => `<span class="text-white/40">${m}</span>`) 
  // Numbers
  s = s.replace(/\b\d+(?:\.\d+)?\b/g, (m) => `<span class="text-amber-300">${m}</span>`) 
  // Keywords (basic set)
  const kw = [
    'SELECT','FROM','WHERE','GROUP','BY','ORDER','HAVING','LIMIT','OFFSET','FETCH','FIRST','ROWS','ONLY',
    'JOIN','INNER','LEFT','RIGHT','FULL','OUTER','ON','AND','OR','NOT','IN','AS','DISTINCT','CASE','WHEN','THEN','ELSE','END',
    'WITH','UNION','ALL','LIKE','BETWEEN','IS','NULL'
  ]
  const kwRegex = new RegExp(`\\b(${kw.join('|')})\\b`, 'gi')
  s = s.replace(kwRegex, (m) => `<span class="text-cyan-300 font-semibold">${m.toUpperCase()}</span>`) 
  // Functions
  const fnRegex = /\b(AVG|SUM|MIN|MAX|COUNT)\s*\(/gi
  s = s.replace(fnRegex, (m) => `<span class="text-purple-300">${m.toUpperCase()}</span>`) 
  return s
}

function validate(sql: string) {
  const trimmed = sql.trim().toUpperCase()
  if (!trimmed) return { level: 'info', message: 'Enter a SQL query' }
  if (!/^SELECT\b|^WITH\b/.test(trimmed)) return { level: 'warn', message: 'Consider starting with SELECT or WITH' }
  // Quick heuristic: check unmatched quotes
  const singleQuotes = (sql.match(/'/g) || []).length
  if (singleQuotes % 2 !== 0) return { level: 'error', message: 'Unmatched quotes detected' }
  return { level: 'ok', message: 'Looks good' }
}

export function SQLInput({ value, onChange, rows = 6 }: SQLInputProps) {
  const html = useMemo(() => highlightSQL(value), [value])
  const v = useMemo(() => validate(value), [value])
  return (
    <div className="relative rounded-md border border-white/10 focus-within:ring-1 focus-within:ring-cyan-400">
      <pre
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none p-3 text-xs font-mono leading-5 whitespace-pre-wrap break-words text-white/70"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        spellCheck={false}
        className="relative bg-transparent text-white p-3 text-xs font-mono leading-5 resize-y w-full outline-none"
      />
      <div className="flex items-center justify-between px-3 pb-2 text-[11px]">
        <div className={v.level === 'error' ? 'text-red-400' : v.level === 'warn' ? 'text-amber-300' : 'text-white/50'}>
          {v.message}
        </div>
        <div className="text-white/40">Syntax highlight: basic SQL</div>
      </div>
    </div>
  )
}

export default SQLInput