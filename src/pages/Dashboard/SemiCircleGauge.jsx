// Semicircular progress gauge (pure SVG). The arc fills `pct` (0–100) of a
// half-circle with an emerald gradient; center shows a headline value, and two
// footer slots carry the breakdown. Used for the monthly collection widget.
export default function SemiCircleGauge({
  pct = 0,
  centerValue,
  centerLabel,
  leftLabel,
  leftValue,
  rightLabel,
  rightValue
}) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0))
  // Semicircle: radius 84, center (100,100), sweeping 180° → 0°.
  const arc = 'M 16 100 A 84 84 0 0 1 184 100'

  return (
    <div className="w-full">
      <div className="relative mx-auto" style={{ maxWidth: 252 }}>
        <svg viewBox="0 0 200 112" className="w-full block">
          <defs>
            <linearGradient id="gauge-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#6ee7b7" />
              <stop offset="55%" stopColor="#34d399" />
              <stop offset="100%" stopColor="#059669" />
            </linearGradient>
          </defs>
          <path d={arc} fill="none" stroke="#eef0f3" strokeWidth="14" strokeLinecap="round" />
          <path
            d={arc}
            fill="none"
            stroke="url(#gauge-grad)"
            strokeWidth="14"
            strokeLinecap="round"
            pathLength="100"
            strokeDasharray={`${p} 100`}
            style={{ transition: 'stroke-dasharray 0.6s cubic-bezier(0.4,0,0.2,1)' }}
          />
        </svg>
        {/* center readout, vertically centered within the arc */}
        <div className="absolute inset-x-0 flex flex-col items-center" style={{ bottom: 8 }}>
          <span className="text-[22px] font-semibold tracking-tight tabular-nums text-gray-900 leading-none">
            {centerValue}
          </span>
          {centerLabel && (
            <span className="text-[11px] text-gray-400 mt-1">{centerLabel}</span>
          )}
        </div>
      </div>

      {(leftLabel || rightLabel) && (
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">{leftLabel}</p>
            <p className="text-sm font-semibold tabular-nums text-gray-800 truncate">{leftValue}</p>
          </div>
          <div className="min-w-0 text-right">
            <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">{rightLabel}</p>
            <p className="text-sm font-semibold tabular-nums text-gray-800 truncate">{rightValue}</p>
          </div>
        </div>
      )}
    </div>
  )
}
