import { Plus, Trash } from 'iconoir-react'
import Input, { Select, Textarea } from '../../../components/ui/Input'

// Editor generico de una lista de objetos (filas). Sin logica de negocio.
// fields: [{ key, label, type?: 'text'|'textarea'|'select', options?, placeholder?, rows? }]
// emptyRow: objeto con las keys por defecto en ''
export function RepeatableRows({ value, onChange, fields, emptyRow, addLabel }) {
  const rows = value || []

  const updateRow = (idx, key, v) => {
    onChange(rows.map((r, i) => i === idx ? { ...r, [key]: v } : r))
  }
  const removeRow = (idx) => onChange(rows.filter((_, i) => i !== idx))
  const addRow = () => onChange([...rows, { ...emptyRow }])

  return (
    <div>
      <div className="flex items-center justify-end mb-4">
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          {addLabel}
        </button>
      </div>
      <div className="space-y-3">
        {rows.length === 0 && (
          <p className="text-sm text-gray-400">Sin registros. Usá "{addLabel}" para agregar.</p>
        )}
        {rows.map((row, idx) => (
          <div key={idx} className="relative flex flex-wrap items-end gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4 pr-10">
            {fields.map((f) => (
              <div key={f.key} className="flex-1 min-w-[140px]">
                {f.type === 'select' ? (
                  <Select
                    label={f.label}
                    value={row[f.key] || ''}
                    onChange={(e) => updateRow(idx, f.key, e.target.value)}
                    options={[{ value: '', label: 'Seleccionar...' }, ...(f.options || [])]}
                  />
                ) : f.type === 'textarea' ? (
                  <Textarea
                    label={f.label}
                    value={row[f.key] || ''}
                    placeholder={f.placeholder || ''}
                    rows={f.rows || 3}
                    onChange={(e) => updateRow(idx, f.key, e.target.value)}
                  />
                ) : (
                  <Input
                    label={f.label}
                    value={row[f.key] || ''}
                    placeholder={f.placeholder || ''}
                    onChange={(e) => updateRow(idx, f.key, e.target.value)}
                  />
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => removeRow(idx)}
              className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-red-500 transition-colors"
              title="Quitar"
              aria-label="Quitar"
            >
              <Trash className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
