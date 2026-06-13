import Card from '../../components/ui/Card'

export default function PlaceholderCard({ title, hint, minHeight = 200 }) {
  return (
    <Card className="border-dashed">
      <div
        className="flex flex-col items-center justify-center text-center px-6 py-8"
        style={{ minHeight }}
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          {title}
        </span>
        <p className="text-sm text-gray-400 mt-2 max-w-xs">{hint}</p>
        <span className="mt-3 text-[11px] font-medium text-indigo-400 bg-indigo-50 px-2 py-0.5 rounded-full">
          próximamente
        </span>
      </div>
    </Card>
  )
}
