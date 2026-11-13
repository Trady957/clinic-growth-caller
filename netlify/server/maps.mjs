// Google Places (New) lookup for one clinic, plus checks of how well it matches our record.
const COUNTRY = { AE: 'United Arab Emirates', SA: 'Saudi Arabia', QA: 'Qatar', KW: 'Kuwait', BH: 'Bahrain', OM: 'Oman', US: 'United States', CA: 'Canada' }
const FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.internationalPhoneNumber', 'places.nationalPhoneNumber',
  'places.rating', 'places.userRatingCount', 'places.businessStatus', 'places.websiteUri', 'places.googleMapsUri', 'places.types',
  'places.utcOffsetMinutes', 'places.addressComponents',
].join(',')

const digits = (s) => String(s || '').replace(/\D/g, '')
const norm = (s) =>
  String(s || '').toLowerCase()
    .replace(/\b(clinic|clinics|center|centre|medical|dental|dentist|polyclinic|llc|fz|the|and|branch|dr|co)\b|مركز|عيادة|طبي|للأسنان/g, ' ')
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim()

function nameScore(a, b) {
  const A = new Set(norm(a).split(' ').filter(Boolean)), B = new Set(norm(b).split(' ').filter(Boolean))
  if (!A.size || !B.size) return 0
  let hit = 0
  for (const w of A) if (B.has(w)) hit++
  return hit / Math.min(A.size, B.size)
}

export async function mapsLookup(key, it) {
  const company = String(it.company || '').trim()
  if (!company) return { id: it.id, error: 'no_name' }
  const textQuery = [company, it.city, COUNTRY[it.market] || it.market].filter(Boolean).join(', ')
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS, 'content-type': 'application/json' },
    body: JSON.stringify({ textQuery, pageSize: 3, regionCode: it.market || undefined, languageCode: 'en' }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) return { id: it.id, error: d.error?.message || `Google returned ${r.status}` }
  const ourPhone = digits(it.phone).slice(-8)
  const ranked = (d.places || []).map((p) => {
    const gPhone = digits(p.internationalPhoneNumber || p.nationalPhoneNumber).slice(-8)
    const phoneMatch = !!(ourPhone && gPhone && ourPhone === gPhone)
    return { p, phoneMatch, gPhone, ns: nameScore(company, p.displayName?.text) }
  }).sort((a, b) => (b.phoneMatch - a.phoneMatch) || (b.ns - a.ns))
  const best = ranked[0]
  if (!best || (!best.phoneMatch && best.ns < 0.5)) return { id: it.id, found: false, query: textQuery }
  const p = best.p
  return {
    id: it.id, found: true, query: textQuery,
    name: p.displayName?.text || null, address: p.formattedAddress || null,
    phone: p.internationalPhoneNumber || null,
    phoneMatches: best.gPhone ? best.phoneMatch : null,
    nameMatch: Math.round(best.ns * 100) / 100,
    rating: typeof p.rating === 'number' ? p.rating : null, count: p.userRatingCount ?? null,
    status: p.businessStatus || null, website: p.websiteUri || null, url: p.googleMapsUri || null,
    placeId: p.id || null, utcOffset: p.utcOffsetMinutes ?? null,
  }
}

const comp = (p, type) => (p.addressComponents || []).find((c) => (c.types || []).includes(type))?.longText || null

// Area search: up to 60 Google results, keeping only operating clinics rated below maxRating.
export async function searchClinics(key, { query, market, maxRating = 4 }) {
  const textQuery = /\b(in|near)\b/i.test(query) || !COUNTRY[market] ? query : `${query}, ${COUNTRY[market]}`
  const all = []
  let pageToken
  for (let page = 0; page < 3; page++) {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS + ',nextPageToken', 'content-type': 'application/json' },
      body: JSON.stringify({ textQuery, pageSize: 20, regionCode: market || undefined, languageCode: 'en', ...(pageToken ? { pageToken } : {}) }),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { if (!all.length) throw new Error(d.error?.message || `Google returned ${r.status}`); break }
    all.push(...(d.places || []))
    pageToken = d.nextPageToken
    if (!pageToken) break
  }
  const seen = new Set()
  const rows = all.filter((p) => p.id && !seen.has(p.id) && seen.add(p.id)).map((p) => ({
    ref: p.id, place_id: p.id, name: p.displayName?.text || '', address: p.formattedAddress || '',
    city: comp(p, 'locality') || comp(p, 'postal_town') || comp(p, 'administrative_area_level_2') || '',
    region: comp(p, 'administrative_area_level_1') || '',
    phone: (p.internationalPhoneNumber || '').replace(/[^\d+]/g, '') || null, phone_type: null,
    website: p.websiteUri || null, rating: typeof p.rating === 'number' ? p.rating : null, reviews: p.userRatingCount ?? 0,
    status: p.businessStatus || null, maps_url: p.googleMapsUri || null, utc_offset: p.utcOffsetMinutes ?? null, types: p.types || [],
  }))
  const kept = rows.filter((x) => x.rating !== null && x.rating < maxRating && x.status === 'OPERATIONAL')
  return { total: rows.length, hidden: rows.length - kept.length, results: kept.sort((a, b) => a.rating - b.rating) }
}

// Placeholder used only when no Google Maps key is configured. Deterministic per clinic, clearly marked as sample.
export function sampleLookup(it) {
  let h = 0
  for (const ch of String(it.id || it.company || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return {
    id: it.id, sample: true, found: true, query: [it.company, it.city].filter(Boolean).join(', '),
    name: `${it.company || 'Clinic'} (SAMPLE)`, address: null, phone: it.phone || null, phoneMatches: null, nameMatch: null,
    rating: Math.round((3.8 + (h % 12) / 10) * 10) / 10, count: 20 + (h % 480), status: 'OPERATIONAL', website: null, url: null,
    placeId: null, utcOffset: null,
  }
}
