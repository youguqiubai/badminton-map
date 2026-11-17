/**
 * POI 检索层。
 *
 * 高德 PlaceSearch 的两个硬限制：
 *   1. 单页最多 50 条，pageIndex 最多到 10 → 单个关键词最多约 500 条
 *   2. 一个城市超过 500 家时会被截断（杭州实测 600+）
 *
 * 对策：整城搜满 10 页后，若 count 仍大于已取数量，则用 DistrictSearch
 * 取下级区县逐个补搜，再按 POI ID 去重。
 */
const PAGE_SIZE = 50
const MAX_PAGE = 10
const REQ_GAP = 110 // 毫秒，控制请求频率避免 QPS 超限
const CACHE_TTL = 24 * 3600 * 1000
const CACHE_PREFIX = 'bm.cache.'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ---------------- 分类 ---------------- */

const RE_TRAIN = /培训|训练|教学|教练|俱乐部|学院|兴趣班|训练营|青训|私教/
const RE_COURT = /羽球|羽毛球/
const RE_GYM = /体育馆|体育中心|文体中心|体育公园|健身中心|综合馆|运动中心|体育场|活动中心/

/** 把高德 POI 归到三类：court 球场 / gym 综合馆 / train 培训 */
export function classify(poi) {
  const n = poi.name || ''
  if (RE_TRAIN.test(n)) return 'train'
  if (RE_COURT.test(n)) return 'court'
  if (RE_GYM.test(n)) return 'gym'
  // 名称里没有明显特征时，看高德原始的 type 字段
  const t = poi.type || ''
  if (/体育场馆|运动场馆/.test(t)) return 'gym'
  return 'court'
}

/* ---------------- 数据清洗 ---------------- */

function normalize(poi) {
  const loc = String(poi.location || '')
  const [lng, lat] = loc.split(',').map(Number)
  if (!lat || !lng || Number.isNaN(lat) || Number.isNaN(lng)) return null

  let district = poi.adname || ''
  // 部分 POI 的 adname 会是空，从地址里兜底截区县名
  if (!district && poi.address) {
    const m = /([\u4e00-\u9fa5]{2,4}(?:区|县|市))/.exec(poi.address)
    if (m) district = m[1]
  }

  return {
    id: poi.id,
    name: poi.name || '未命名',
    address: poi.address || '',
    tel: typeof poi.tel === 'string' ? poi.tel : '',
    district: district || '其他',
    type: classify(poi),
    lat,
    lng,
  }
}

function dedupe(list) {
  const map = new Map()
  for (const v of list) {
    if (!v) continue
    if (!map.has(v.id)) map.set(v.id, v)
  }
  // 同名同坐标的重复 POI（高德常见）再压一轮
  const seen = new Set()
  const out = []
  for (const v of map.values()) {
    const k = `${v.name}@${v.lat.toFixed(5)},${v.lng.toFixed(5)}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(v)
  }
  return out
}

/* ---------------- 检索 ---------------- */

function searchPages(place, onPage) {
  return new Promise(async (resolve) => {
    const collected = []
    let total = 0
    for (let page = 1; page <= MAX_PAGE; page++) {
      place.setPageIndex(page)
      const r = await new Promise((res) => {
        place.search('羽毛球馆', (status, result) => {
          if (status !== 'complete' || !result || !result.poiList) {
            return res({ pois: [], total: 0 })
          }
          res({
            pois: result.poiList.pois || [],
            total: result.poiList.count || 0,
          })
        })
      })
      total = r.total || total
      if (!r.pois.length) break
      collected.push(...r.pois)
      onPage && onPage(collected.length, total)
      if (r.pois.length < PAGE_SIZE) break
      await sleep(REQ_GAP)
    }
    resolve({ pois: collected, total })
  })
}

function getSubDistricts(city) {
  return new Promise((resolve) => {
    if (!window.AMap) return resolve([])
    const ds = new window.AMap.DistrictSearch({
      level: 'city',
      subdistrict: 1,
      extensions: 'base',
    })
    ds.search(city, (status, result) => {
      if (status !== 'complete' || !result || !result.districtList || !result.districtList.length) {
        return resolve([])
      }
      const subs = result.districtList[0].districtList || []
      resolve(subs.map((d) => d.name).filter(Boolean))
    })
  })
}

/** IP 定位当前城市（不需要 HTTPS，精度只到城市级） */
export function locateCity() {
  return new Promise((resolve) => {
    if (!window.AMap) return resolve({ ok: false, city: '' })
    const cs = new window.AMap.CitySearch()
    cs.getLocalCity((status, result) => {
      if (status === 'complete' && result && result.city) {
        resolve({ ok: true, city: result.city })
      } else {
        resolve({ ok: false, city: '' })
      }
    })
  })
}

/* ---------------- 缓存 ---------------- */

function readCache(city) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + city)
    if (!raw) return null
    const obj = JSON.parse(raw)
    if (!obj || !obj.ts || Date.now() - obj.ts > CACHE_TTL) return null
    if (!Array.isArray(obj.data) || !obj.data.length) return null
    return obj.data
  } catch {
    return null
  }
}

function writeCache(city, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + city, JSON.stringify({ ts: Date.now(), data }))
  } catch {
    /* 容量超限时静默失败，不影响使用 */
  }
}

export function clearCache(city) {
  try {
    if (city) localStorage.removeItem(CACHE_PREFIX + city)
    else {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(CACHE_PREFIX))
        .forEach((k) => localStorage.removeItem(k))
    }
  } catch {
    /* ignore */
  }
}

/* ---------------- 对外主函数 ---------------- */

/**
 * 检索一个城市的羽毛球馆。
 * @param {string} city 城市名，如「杭州」
 * @param {(loaded:number, total:number, scope:string)=>void} onProgress
 */
export async function searchCity(city, onProgress) {
  const cached = readCache(city)
  if (cached) {
    onProgress && onProgress(cached.length, cached.length, city + '（本地缓存）')
    return { venues: cached, fromCache: true }
  }

  const place = new window.AMap.PlaceSearch({
    city,
    citylimit: true,
    pageSize: PAGE_SIZE,
    extensions: 'all',
  })

  onProgress && onProgress(0, 0, city)
  const { pois, total } = await searchPages(place, onProgress)

  let merged = pois
  // 超过 500 条说明被截断，按区县补搜
  if (total > pois.length) {
    const subs = await getSubDistricts(city)
    const seen = new Set(pois.map((p) => p.id))
    for (const d of subs) {
      onProgress && onProgress(seen.size, total, d)
      const dp = new window.AMap.PlaceSearch({
        city: d,
        citylimit: true,
        pageSize: PAGE_SIZE,
        extensions: 'all',
      })
      const r = await searchPages(dp)
      for (const p of r.pois) {
        if (!seen.has(p.id)) {
          seen.add(p.id)
          merged.push(p)
        }
      }
      await sleep(REQ_GAP)
    }
  }

  const venues = dedupe(merged.map(normalize))
  if (venues.length) writeCache(city, venues)
  return { venues, fromCache: false }
}
