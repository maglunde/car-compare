import { useState } from 'react'
import { Car } from './data/cars'
import { SearchBar, CarSuggestion } from './components/SearchBar'
import { CarTable } from './components/CarTable'
import './App.css'

export interface PendingCar {
  id: string
  make: string
  model: string
  year: number
  loading: true
}

export type CarOrPending = Car | PendingCar

function suggestionId(s: CarSuggestion): string {
  return `${s.make}-${s.model}`.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

export function App() {
  const [cars, setCars] = useState<CarOrPending[]>([])
  const [pivoted, setPivoted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedIds = cars.map((c) => c.id)

  const handleSelect = async (suggestion: CarSuggestion) => {
    const id = suggestionId(suggestion)
    if (selectedIds.includes(id)) return

    const pending: PendingCar = { id, make: suggestion.make, model: suggestion.model, year: suggestion.year ?? new Date().getFullYear(), loading: true }
    setCars((prev) => [...prev, pending])
    setError(null)

    try {
      const res = await fetch('/api/cars/specs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(suggestion),
      })
      if (!res.ok) throw new Error(await res.text())
      const specs: Car = await res.json()
      setCars((prev) => prev.map((c) => (c.id === id ? { ...specs, id } : c)))
    } catch (err) {
      setError(`Kunne ikke hente spec for ${suggestion.make} ${suggestion.model}.`)
      setCars((prev) => prev.filter((c) => c.id !== id))
    }
  }

  const removeCar = (id: string) => {
    setCars((prev) => prev.filter((c) => c.id !== id))
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Bilsammenlikning</h1>
        <p className="subtitle">Sammenlign elbiler for nybilkjøp i Norge · 2024-modeller</p>
      </header>

      <main className="app-main">
        <div className="search-section">
          <SearchBar selectedIds={selectedIds} onSelect={handleSelect} />
          <span className="car-count">
            {cars.length} bil{cars.length !== 1 ? 'er' : ''} valgt
          </span>
          <button
            className={`pivot-btn${pivoted ? ' pivot-btn--active' : ''}`}
            onClick={() => setPivoted((v) => !v)}
            title="Roter tabell"
          >
            <span className="pivot-icon">⇄</span>
            {pivoted ? 'Biler som kolonner' : 'Biler som rader'}
          </button>
        </div>

        {error && (
          <div className="error-banner">
            {error}
            <button className="error-close" onClick={() => setError(null)}>×</button>
          </div>
        )}

        <div className="legend">
          <span className="best-indicator" />
          Beste verdi i kategorien
        </div>

        <CarTable cars={cars} onRemove={removeCar} pivoted={pivoted} />
      </main>
    </div>
  )
}
