import { useEffect, useState } from 'react'
import { getReasonLabelMap } from '../services/churn/deactivationReasonService'

// key -> label map for deactivation reasons (includes inactive, so historical labels resolve)
export function useReasonLabels() {
  const [labels, setLabels] = useState({})
  useEffect(() => {
    let active = true
    getReasonLabelMap().then(map => { if (active) setLabels(map) }).catch(() => {})
    return () => { active = false }
  }, [])
  return labels
}
