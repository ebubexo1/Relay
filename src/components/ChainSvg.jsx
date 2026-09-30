import { fmt } from '../lib/format'

// Fission tree: root on the left, each forward splits a branch downward.
// Depth comes from chain order, so settlement can be read FIFO, root to leaf.
export default function ChainSvg({ promise, onNode, onEdge }) {
  const root = (promise.chain && promise.chain.root) || 'A'
  const edges = [{ from: 'A', to: 'B (you)', amount: 5000 }].concat(
    promise.chain ? promise.chain.edges : []
  )

  // BFS depths from the root so children always sit right of their parent.
  const depth = { [root]: 0 }
  let grew = true
  while (grew) {
    grew = false
    edges.forEach((e) => {
      if (depth[e.from] !== undefined && depth[e.to] === undefined) {
        depth[e.to] = depth[e.from] + 1
        grew = true
      }
    })
  }
  const names = []
  edges.forEach((e) => {
    if (!names.includes(e.from)) names.push(e.from)
    if (!names.includes(e.to)) names.push(e.to)
  })
  names.forEach((n) => {
    if (depth[n] === undefined) depth[n] = 0
  })

  const byDepth = {}
  names.forEach((n) => {
    const d = depth[n]
    byDepth[d] = byDepth[d] || []
    byDepth[d].push(n)
  })
  const maxDepth = Math.max(...Object.keys(byDepth).map(Number))
  const COL = 150
  const ROW = 76
  const W = 90 + (maxDepth + 1) * COL
  const H = Math.max(200, Math.max(...Object.values(byDepth).map((a) => a.length)) * ROW + 70)

  const pos = {}
  Object.entries(byDepth).forEach(([d, arr]) => {
    const top = (H - (arr.length - 1) * ROW) / 2
    arr.forEach((n, i) => {
      pos[n] = { x: 60 + Number(d) * COL, y: top + i * ROW }
    })
  })

  const isYou = (n) => n.includes('you')
  const initial = (n) => (n.match(/[A-Za-z]/) ? n.match(/[A-Za-z]/)[0].toUpperCase() : '?')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 480 }} role="tree" aria-label="Promise forwarding tree">
      {edges.map((e, i) => {
        const a = pos[e.from]
        const b = pos[e.to]
        if (!a || !b) return null
        const mx = (a.x + b.x) / 2
        const path = `M ${a.x + 22} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x - 22} ${b.y}`
        return (
          <g key={'e' + i}>
            <path d={path} fill="none" stroke="#cbd5e1" strokeWidth="2" />
            <circle cx={mx} cy={(a.y + b.y) / 2} r="0.5" fill="none" />
            <text x={mx} y={(a.y + b.y) / 2 - 9} textAnchor="middle" fontSize="11" fontWeight="700" fill="#0f172a">
              {fmt(e.amount)}
            </text>
            <path
              d={path}
              fill="none"
              stroke="transparent"
              strokeWidth="18"
              className="cursor-pointer"
              onClick={() => onEdge(e.from, e.to, e.amount)}
            >
              <title>{e.from} → {e.to}: {fmt(e.amount)}</title>
            </path>
          </g>
        )
      })}
      {names.map((n, i) => {
        const p = pos[n]
        const you = isYou(n)
        return (
          <g key={'n' + i} className="cursor-pointer" onClick={() => onNode(n)}>
            <title>{n} — tap to inspect</title>
            <circle cx={p.x} cy={p.y} r="22" fill={you ? '#0f172a' : '#ffffff'} stroke={you ? '#0f172a' : '#cbd5e1'} strokeWidth="2" />
            <text x={p.x} y={p.y + 5} textAnchor="middle" fontSize="14" fontWeight="800" fill={you ? '#ffffff' : '#0f172a'}>
              {initial(n)}
            </text>
            {i === 0 && (
              <text x={p.x} y={p.y - 30} textAnchor="middle" fontSize="9" fontWeight="800" letterSpacing="1.5" fill="#94a3b8">
                ORIGIN
              </text>
            )}
            <text x={p.x} y={p.y + 38} textAnchor="middle" fontSize="11" fontWeight="600" fill="#475569">
              {n.length > 12 ? n.slice(0, 11) + '…' : n}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
