import { useState, useRef, useEffect } from 'react'
import { useDebounce } from '../hooks/useDebounce'

export interface CarSuggestion {
  make: string
  model: string
  year?: number
}

interface Props {
  selectedIds: string[]
  onSelect: (suggestion: CarSuggestion) => void
}

export function SearchBar({ selectedIds, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CarSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)
  const debouncedQuery = useDebounce(query, 300)

  const carId = (s: CarSuggestion) =>
    `${s.make}-${s.model}`.toLowerCase().replace(/[^a-z0-9]+/g, '-')

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([])
      return
    }

    let cancelled = false
    setLoading(true)

    fetch('/api/cars/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: debouncedQuery }),
    })
      .then((r) => r.json())
      .then((data: { cars: CarSuggestion[] }) => {
        if (!cancelled) {
          setResults(data.cars)
          setActiveIndex(-1)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [debouncedQuery])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Reset active index when results change to avoid out-of-bounds
  useEffect(() => {
    setActiveIndex(-1)
  }, [results])

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex >= 0 && open) {
      const items = ref.current?.querySelectorAll('.search-item')
      if (items && items[activeIndex]) {
        items[activeIndex].scrollIntoView({ block: 'nearest' })
      }
    }
  }, [activeIndex, open])

  return (
    <div ref={ref} className="search-wrapper">
      <input
        className="search-input"
        type="text"
        placeholder="Søk etter bil (f.eks. Tesla, BMW, Hyundai…)"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open || results.length === 0) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActiveIndex((i) => {
              let next = i + 1
              while (next < results.length && selectedIds.includes(carId(results[next]))) next++
              return next < results.length ? next : i
            })
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActiveIndex((i) => {
              let next = i - 1
              while (next >= 0 && selectedIds.includes(carId(results[next]))) next--
              return next >= 0 ? next : i
            })
          } else if (e.key === 'Enter' && activeIndex >= 0) {
            e.preventDefault()
            const car = results[activeIndex]
            if (selectedIds.includes(carId(car))) return
            onSelect(car)
            // Advance to next selectable item
            setActiveIndex((i) => {
              let next = i + 1
              while (next < results.length && selectedIds.includes(carId(results[next]))) next++
              return next < results.length ? next : i
            })
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {loading && <span className="search-spinner" />}

      {open && (results.length > 0 || (loading && query.trim())) && (
        <ul className="search-dropdown">
          {loading && results.length === 0 && (
            <li className="search-item search-item--loading">Søker…</li>
          )}
          {results.map((car, i) => {
            const isSelected = selectedIds.includes(carId(car))
            return (
              <li
                key={`${car.make}-${car.model}`}
                className={`search-item${!isSelected && i === activeIndex ? ' search-item--active' : ''}${isSelected ? ' search-item--disabled' : ''}`}
                onMouseEnter={() => { if (!isSelected) setActiveIndex(i) }}
                onMouseDown={(e) => {
                  e.preventDefault()
                  if (isSelected) return
                  onSelect(car)
                }}
              >
                <span className="search-item-name">
                  {car.make} {car.model}
                </span>
                {isSelected && <span className="search-item-badge">Lagt til</span>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
