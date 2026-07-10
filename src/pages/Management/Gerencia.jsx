import { useState } from 'react'
import Tabs from '../../components/ui/Tabs'
import AccessList from '../Access/AccessList'
import PlanPricingManager from './PlanPricingManager'

const TABS = [
  { id: 'accesos', label: 'Accesos' },
  { id: 'planes', label: 'Gestión de planes' }
]

export default function Gerencia() {
  const [activeTab, setActiveTab] = useState('accesos')

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Gerencia</h1>
        <p className="text-sm text-gray-500 mt-1">Usuarios del sistema y precios de planes</p>
      </div>

      <div className="mb-6">
        <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />
      </div>

      {activeTab === 'accesos' ? <AccessList /> : <PlanPricingManager />}
    </div>
  )
}
