import express from 'express'
import cors from 'cors'
import * as cheerio from 'cheerio'
import { getEvCatalog, resolveCarUrl } from './evCatalog'

const app = express()
app.use(cors())
app.use(express.json())

// ---------- Search (backed by live ev-database.org catalog) ----------

app.post('/api/cars/search', async (req, res) => {
  console.log('yoyoyo');
  const { query } = req.body as { query: string }
  if (!query?.trim()) {
    res.json({ cars: [] })
    return
  }
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 0)
  try {
    const catalog = await getEvCatalog()
    const seen = new Set<string>()
    const results = catalog
      .filter((e) => {
        const key = `${e.make}|${e.model}`
        const fullText = `${e.make} ${e.model}`.toLowerCase()
        // Check if all query words appear in the full text
        const matches = queryWords.every(word => fullText.includes(word))
        if (!matches) return false
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .map((e) => ({ make: e.make, model: e.model }))
    res.json({ cars: results })
  } catch {
    res.json({ cars: [] })
  }
})

// ---------- Specs (scraped from ev-database.org) ----------

interface Car {
  id: string
  make: string
  model: string
  year: number
  priceNOK: number
  wltpKm: number
  realRangeKm: number
  batteryKwh: number
  chargingKwFast: number
  chargingKwAC: number
  zeroToHundred: number
  trunkLiters: number
  topSpeedKmh: number
  ncapStars: number
}

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

// 7-day cache for scraped specs — specs change rarely
const specsCache = new Map<string, { data: Car; fetchedAt: number }>()
const SPECS_TTL_MS = 7 * 24 * 60 * 60 * 1000

function parseNum(s: string): number {
  const n = parseFloat(s.replace(/[^0-9.]/g, ''))
  return isNaN(n) ? 0 : n
}

/** Read one labelled row from the spec table.
 * Prefix label with "=" for exact match (also rejects rows whose label contains *)
 * Otherwise does substring match (ignores asterisks in label). */
function getRowValue(
  $: ReturnType<typeof cheerio.load>,
  ...labels: string[]
): string {
  let value = ''
  $('tr').each((_, row) => {
    if (value) return
    const cells = $(row).find('td')
    if (cells.length < 2) return
    const rawLabel = $(cells[0]).text().trim()
    const cleanLabel = rawLabel.replace(/[\s*†]+/g, ' ').trim().toLowerCase()
    const hasAsterisk = rawLabel.includes('*') || rawLabel.includes('†')
    for (const l of labels) {
      const exact = l.startsWith('=')
      const needle = exact ? l.slice(1).toLowerCase() : l.toLowerCase()
      if (exact && !hasAsterisk && cleanLabel === needle) {
        value = $(cells[1]).text().trim()
        break
      }
      if (!exact && cleanLabel.includes(needle)) {
        value = $(cells[1]).text().trim()
        break
      }
    }
  })
  return value
}

/** Try to get Norwegian list price from finn.no new car search.
 * finn.no serves __NEXT_DATA__ server-side with search results. */
async function fetchFinnPrice(make: string, model: string): Promise<number> {
  try {
    const q = encodeURIComponent(`${make} ${model}`)
    const html = await fetch(
      `https://www.finn.no/car/new/search.html?q=${q}`,
      { headers: FETCH_HEADERS },
    ).then((r) => r.text())

    // Try __NEXT_DATA__ JSON blob (Next.js server-side data)
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/)
    if (match) {
      const data = JSON.parse(match[1])
      const docs: unknown[] =
        data?.props?.pageProps?.initialProps?.docs ??
        data?.props?.pageProps?.searchResult?.docs ??
        []
      for (const doc of docs as Record<string, unknown>[]) {
        const price =
          (doc['price'] as Record<string, number> | undefined)?.amount ??
          (doc['main_price'] as number | undefined)
        if (typeof price === 'number' && price > 200_000 && price < 3_000_000) {
          return price
        }
      }
    }
  } catch {
    // best-effort only
  }
  return 0
}

async function scrapeCarPage(
  carUrl: string,
  make: string,
  model: string,
  year: number,
): Promise<Car> {
  const html = await fetch(carUrl, { headers: FETCH_HEADERS }).then((r) => r.text())
  const $ = cheerio.load(html)

  const wltp = parseNum(getRowValue($, '=range'))
  const realRange = parseNum(getRowValue($, 'electric range'))
  const battery = parseNum(getRowValue($, 'useable capacity'))
  const acCharge = parseNum(getRowValue($, '=charge power'))
  const fastCharge = parseNum(getRowValue($, 'charge power (max)'))
  const zeroTo100 = parseNum(getRowValue($, 'acceleration 0 - 100'))
  const topSpeed = parseNum(getRowValue($, 'top speed'))
  const trunk = parseNum(getRowValue($, '=cargo volume'))

  // Try ev-database.org Norway price row first
  let priceNOK = 0
  $('tr').each((_, row) => {
    if (priceNOK) return
    const cells = $(row).find('td')
    if (cells.length < 2) return
    const label = $(cells[0]).text().trim()
    const value = $(cells[1]).text().trim()
    if (label === 'Norway' || label.toLowerCase().includes('norway')) {
      const m = value.match(/[\d\s,.]+/)
      if (m) {
        const raw = parseFloat(m[0].replace(/[\s,]/g, ''))
        if (raw > 100_000 && raw < 5_000_000) priceNOK = raw
      }
    }
  })

  // Fall back to finn.no if ev-database had no Norwegian price
  if (!priceNOK) {
    priceNOK = await fetchFinnPrice(make, model)
    if (priceNOK) console.log(`[price] ${make} ${model}: finn.no → ${priceNOK} kr`)
  }

  let ncapStars = 5
  const ncapText = getRowValue($, 'ncap', 'euro ncap', 'safety')
  if (ncapText) {
    const m = ncapText.match(/(\d)/)
    if (m) ncapStars = parseInt(m[1])
  }

  return {
    id: `${make}-${model}-${year}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    make,
    model,
    year,
    priceNOK,
    wltpKm: wltp,
    realRangeKm: realRange || Math.round(wltp * 0.8),
    batteryKwh: battery,
    chargingKwFast: fastCharge,
    chargingKwAC: acCharge,
    zeroToHundred: zeroTo100,
    trunkLiters: trunk,
    topSpeedKmh: topSpeed,
    ncapStars,
  }
}

app.post('/api/cars/specs', async (req, res) => {
  const { make, model, year } = req.body as { make: string; model: string; year: number }
  const cacheKey = `${make}|${model}|${year}`

  // Return cached specs if still fresh
  const cached = specsCache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < SPECS_TTL_MS) {
    console.log(`[specs] ${make} ${model} → cache hit`)
    res.json(cached.data)
    return
  }

  try {
    const carUrl = await resolveCarUrl(make, model)
    if (!carUrl) {
      res.status(404).json({ error: `Fant ikke ${make} ${model} på ev-database.org` })
      return
    }
    console.log(`[specs] ${make} ${model} → ${carUrl}`)
    const specs = await scrapeCarPage(carUrl, make, model, year)
    specsCache.set(cacheKey, { data: specs, fetchedAt: Date.now() })
    res.json(specs)
  } catch (err) {
    console.error('Specs error:', err)
    res.status(500).json({ error: String(err) })
  }
})

const PORT = process.env.PORT ?? 3001
app.listen(PORT, () => {
  console.log(`Server on http://localhost:${PORT}`)
  // Pre-warm catalog cache so first search is instant
  getEvCatalog().catch((err) => console.error('[catalog] Pre-warm failed:', err))
})
