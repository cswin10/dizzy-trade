// Lightweight SVG sparkline for the dashboard widget. No recharts:
// it's a single polyline plus a soft area fill, sized to whatever
// container it's dropped into. Auto-scales to the data range.

export type SparklinePoint = { x: number; y: number }

export type MiniSparklineProps = {
  data: SparklinePoint[]
  height?: number
  ariaLabel?: string
  className?: string
}

const DEFAULT_HEIGHT = 80
const VIEWBOX_WIDTH = 600

export function MiniSparkline({
  data,
  height = DEFAULT_HEIGHT,
  ariaLabel,
  className,
}: MiniSparklineProps) {
  if (data.length === 0) {
    return (
      <div aria-label={ariaLabel} className={className} style={{ height }} />
    )
  }

  // If only one point, double it so the polyline has length to draw.
  const points = data.length === 1 ? [data[0]!, data[0]!] : data
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const yMin = Math.min(...ys)
  const yMax = Math.max(...ys)
  const xSpan = xMax - xMin || 1
  const ySpan = yMax - yMin || 1

  const VIEWBOX_HEIGHT = 100
  const padY = 6
  const drawableHeight = VIEWBOX_HEIGHT - padY * 2

  const projected = points.map((p) => {
    const xN = ((p.x - xMin) / xSpan) * VIEWBOX_WIDTH
    const yN = padY + (1 - (p.y - yMin) / ySpan) * drawableHeight
    return { x: xN, y: yN }
  })
  const linePath = projected
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' ')
  const areaPath = `${linePath} L ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT} L 0 ${VIEWBOX_HEIGHT} Z`

  return (
    <svg
      aria-label={ariaLabel}
      role={ariaLabel ? 'img' : undefined}
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      preserveAspectRatio="none"
      className={className}
      style={{ height, width: '100%', display: 'block' }}
    >
      <defs>
        <linearGradient id="dt-spark-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3B82FF" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#3B82FF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#dt-spark-gradient)" />
      <path
        d={linePath}
        fill="none"
        stroke="#3B82FF"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        style={{
          filter: 'drop-shadow(0 0 6px rgba(59,130,255,0.45))',
        }}
      />
    </svg>
  )
}
