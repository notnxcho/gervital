/**
 * Small accessible on/off switch with an optional label.
 */
export default function Toggle({ checked, onChange, label, id }) {
  return (
    <div className="flex items-center gap-2 select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        id={id}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-1 ${
          checked ? 'bg-indigo-600' : 'bg-gray-300'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-1'
          }`}
        />
      </button>
      {label && (
        <label htmlFor={id} className="text-sm text-gray-600 cursor-pointer">
          {label}
        </label>
      )}
    </div>
  )
}
