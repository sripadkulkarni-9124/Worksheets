import { InlineMath, BlockMath } from 'react-katex'
import 'katex/dist/katex.min.css'

/**
 * Renders text containing LaTeX markers:
 *   $$...$$  → BlockMath
 *   $...$    → InlineMath
 * Everything else as plain text.
 */
export default function MathText({ children, className }: { children?: string | null; className?: string }) {
  if (!children) return null
  const parts: Array<{ t: 'text' | 'inline' | 'block'; v: string }> = []
  let rest = children
  const re = /(\$\$[\s\S]+?\$\$|\$[^\$\n]+?\$)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(rest))) {
    if (m.index > last) parts.push({ t: 'text', v: rest.slice(last, m.index) })
    const token = m[0]
    if (token.startsWith('$$')) parts.push({ t: 'block', v: token.slice(2, -2).trim() })
    else parts.push({ t: 'inline', v: token.slice(1, -1).trim() })
    last = m.index + token.length
  }
  if (last < rest.length) parts.push({ t: 'text', v: rest.slice(last) })

  return (
    <span className={className}>
      {parts.map((p, i) => {
        if (p.t === 'text') return <span key={i}>{p.v}</span>
        const fallback = (err: Error) => (
          <span key={i} className="font-mono text-amber-300" title={err.message}>
            {p.t === 'block' ? `$$${p.v}$$` : `$${p.v}$`}
          </span>
        )
        return p.t === 'block'
          ? <BlockMath key={i} math={p.v} renderError={fallback} />
          : <InlineMath key={i} math={p.v} renderError={fallback} />
      })}
    </span>
  )
}
