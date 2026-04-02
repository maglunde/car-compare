import * as cheerio from 'cheerio'

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

export interface EvCatalogEntry {
  id: number
  slug: string
  url: string
  make: string
  model: string
}

// Multi-word makes as they appear in ev-database.org URL slugs
const MULTI_WORD_MAKES = [
  'Land-Rover',
  'Alfa-Romeo',
  'Aston-Martin',
  'DS-Automobiles',
  'Great-Wall',
]

let catalogCache: EvCatalogEntry[] | null = null
let catalogFetchedAt = 0
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000

function parseSlugToMakeModel(slug: string): { make: string; model: string } {
  for (const mwMake of MULTI_WORD_MAKES) {
    if (slug.startsWith(mwMake + '-')) {
      return {
        make: mwMake.replace(/-/g, ' '),
        model: slug.slice(mwMake.length + 1).replace(/-/g, ' '),
      }
    }
  }
  const dashIdx = slug.indexOf('-')
  if (dashIdx === -1) return { make: slug, model: '' }
  return {
    make: slug.slice(0, dashIdx),
    model: slug.slice(dashIdx + 1).replace(/-/g, ' '),
  }
}

function parseSitemapXml(xml: string): EvCatalogEntry[] {
  const $ = cheerio.load(xml, { xmlMode: true })
  const entries: EvCatalogEntry[] = []
  const seen = new Set<number>()

  $('loc').each((_, el) => {
    const url = $(el).text().trim()
    const match = url.match(/\/car\/(\d+)\/([A-Za-z0-9][^/]*)$/)
    if (!match) return
    const id = parseInt(match[1])
    if (seen.has(id)) return
    seen.add(id)
    const slug = match[2]
    const { make, model } = parseSlugToMakeModel(slug)
    entries.push({ id, slug, url, make, model })
  })

  return entries
}

export async function getEvCatalog(): Promise<EvCatalogEntry[]> {
  const now = Date.now()
  console.log('hallo fra getEvCatalog()');
  if (catalogCache && now - catalogFetchedAt < CATALOG_TTL_MS) {
    return catalogCache
  }
  console.log('[catalog] Fetching sitemap from ev-database.org…')
  const xml = await fetch('https://ev-database.org/sitemap.xml', {
    headers: FETCH_HEADERS,
  }).then((r) => r.text())
  catalogCache = parseSitemapXml(xml)
  catalogFetchedAt = now
  console.log(`[catalog] Loaded ${catalogCache.length} car entries`)
  return catalogCache
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export async function resolveCarUrl(make: string, model: string): Promise<string | null> {
  const catalog = await getEvCatalog()
  const makeLower = normalise(make)
  const modelWords = normalise(model).split(' ').filter((w) => w.length > 1)

  let bestEntry: EvCatalogEntry | null = null
  let bestScore = -1

  for (const entry of catalog) {
    if (normalise(entry.make) !== makeLower) continue
    const entryModel = normalise(entry.model)
    let score = 0
    for (const word of modelWords) {
      if (entryModel.includes(word)) score++
    }
    // Prefer higher score; tie-break on higher ID (= more recent/specific entry)
    if (score > bestScore || (score === bestScore && entry.id > (bestEntry?.id ?? 0))) {
      bestScore = score
      bestEntry = entry
    }
  }

  return bestEntry && bestScore > 0 ? bestEntry.url : null
}
