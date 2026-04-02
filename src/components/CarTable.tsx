import type { ReactNode } from 'react'
import { Car } from '../data/cars'
import { CarOrPending, PendingCar } from '../App'

interface Props {
  cars: CarOrPending[]
  onRemove: (id: string) => void
  pivoted: boolean
}

type SortKey = keyof Car

function isPending(car: CarOrPending): car is PendingCar {
  return (car as PendingCar).loading === true
}

function NcapStars({ stars }: { stars: number }) {
  return (
    <span className="ncap-stars">
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={i < stars ? 'star-filled' : 'star-empty'}>★</span>
      ))}
    </span>
  )
}

function Skeleton() {
  return <span className="skeleton" />
}

const columns: { key: SortKey; label: string; unit?: string; lowerIsBetter?: boolean }[] = [
  { key: 'priceNOK', label: 'Pris', unit: 'kr', lowerIsBetter: true },
  { key: 'wltpKm', label: 'WLTP', unit: 'km' },
  { key: 'realRangeKm', label: 'Reell rekkevidde', unit: 'km' },
  { key: 'batteryKwh', label: 'Batteri', unit: 'kWh' },
  { key: 'chargingKwFast', label: 'DC hurtiglading', unit: 'kW' },
  { key: 'chargingKwAC', label: 'AC lading', unit: 'kW' },
  { key: 'zeroToHundred', label: '0–100 km/t', unit: 's', lowerIsBetter: true },
  { key: 'trunkLiters', label: 'Bagasjerom', unit: 'L' },
  { key: 'topSpeedKmh', label: 'Toppfart', unit: 'km/t' },
  { key: 'ncapStars', label: 'Euro NCAP', unit: '' },
]

function getBestValue(cars: Car[], key: SortKey, lowerIsBetter?: boolean): number {
  // Exclude missing values (0) from best-value comparison
  const values = cars.map((c) => c[key] as number).filter((v) => v > 0)
  if (values.length === 0) return -1
  return lowerIsBetter ? Math.min(...values) : Math.max(...values)
}

function renderValue(key: SortKey, val: number, unit?: string): ReactNode {
  if (key === 'ncapStars') return <NcapStars stars={val} />
  if (key === 'priceNOK') return val > 0 ? `${val.toLocaleString('nb-NO')} kr` : '—'
  if (val === 0) return '—'
  return `${val}${unit ? ' ' + unit : ''}`
}

function CarLabel({ car, onRemove }: { car: CarOrPending; onRemove: (id: string) => void }) {
  return (
    <div className="car-header">
      <div className="car-name">{car.make}</div>
      <div className="car-model">
        {car.model}
        {isPending(car) && <span className="loading-badge">Henter…</span>}
      </div>
      <div className="car-year">{car.year}</div>
      <button className="remove-btn" onClick={() => onRemove(car.id)} title="Fjern bil">×</button>
    </div>
  )
}

export function CarTable({ cars, onRemove, pivoted }: Props) {
  if (cars.length === 0) {
    return <p className="empty-msg">Ingen biler valgt. Søk og legg til biler ovenfor.</p>
  }

  const loadedCars = cars.filter((c): c is Car => !isPending(c))

  if (!pivoted) {
    return (
      <div className="table-scroll">
        <table className="car-table">
          <thead>
            <tr>
              <th className="col-label">Spesifikasjon</th>
              {cars.map((car) => (
                <th key={car.id} className="col-car">
                  <CarLabel car={car} onRemove={onRemove} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {columns.map(({ key, label, unit, lowerIsBetter }) => {
              const best = loadedCars.length > 1 ? getBestValue(loadedCars, key, lowerIsBetter) : null
              return (
                <tr key={key}>
                  <td className="row-label">{label}</td>
                  {cars.map((car) => {
                    if (isPending(car)) {
                      return (
                        <td key={car.id} className="row-val">
                          <Skeleton />
                        </td>
                      )
                    }
                    const val = car[key] as number
                    const isBest = best !== null && val === best
                    return (
                      <td key={car.id} className={`row-val${isBest ? ' best-val' : ''}`}>
                        {renderValue(key, val, unit)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  // Pivoted: cars as rows, specs as columns
  return (
    <div className="table-scroll">
      <table className="car-table">
        <thead>
          <tr>
            <th className="col-label">Bil</th>
            {columns.map(({ key, label }) => (
              <th key={key} className="col-spec">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cars.map((car) => (
            <tr key={car.id}>
              <td className="row-car-label">
                <CarLabel car={car} onRemove={onRemove} />
              </td>
              {columns.map(({ key, label, unit, lowerIsBetter }) => {
                if (isPending(car)) {
                  return (
                    <td key={key} className="row-val">
                      <Skeleton />
                    </td>
                  )
                }
                const best = loadedCars.length > 1 ? getBestValue(loadedCars, key, lowerIsBetter) : null
                const val = car[key] as number
                const isBest = best !== null && val === best
                return (
                  <td key={key} className={`row-val${isBest ? ' best-val' : ''}`}>
                    {renderValue(key, val, unit)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
