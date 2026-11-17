/**
 * 视图层：地图标记、聚合、信息窗、列表、统计。
 * 只负责「给定 venues + 筛选条件 → 渲染」，不做任何数据获取。
 */
export const KIND = {
  court: { label: '羽毛球场', color: '#0d9488', rgb: '13,148,136' },
  gym: { label: '综合体育馆', color: '#2563eb', rgb: '37,99,235' },
  train: { label: '培训机构', color: '#d97706', rgb: '217,119,6' },
}

const $ = (id) => document.getElementById(id)
const esc = (s) =>
  String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  )

const SHEET_COVER = 84
const isNarrow = () => window.innerWidth <= 760

/* ---------------- 状态 ---------------- */

let venues = []
let map = null
let infoWindow = null
let markers = []
let markerTimer = null
let listTimer = null

export const state = { q: '', district: '', type: 'all', active: -1 }

export function setVenues(list) {
  venues = list || []
  state.district = ''
  state.active = -1
  fillDistricts()
  renderStats()
  render()
  fitAll()
}

export function setFilter(patch) {
  Object.assign(state, patch)
  scheduleRender()
}

function match(v) {
  if (state.type !== 'all' && v.type !== state.type) return false
  if (state.district && v.district !== state.district) return false
  if (state.q) {
    const q = state.q.trim().toLowerCase()
    if (q && !`${v.name}${v.address}${v.district}`.toLowerCase().includes(q)) return false
  }
  return true
}

/* ---------------- 统计与下拉 ---------------- */

function renderStats() {
  const n = venues.length
  $('totalN').textContent = n
  $('courtN').textContent = venues.filter((v) => v.type === 'court').length
  $('gymN').textContent = venues.filter((v) => v.type === 'gym').length
  $('trainN').textContent = venues.filter((v) => v.type === 'train').length
  const sb = $('sbCount')
  if (sb) sb.textContent = n ? `${n} 个场地` : '暂无数据'
}

function fillDistricts() {
  const sel = $('dist')
  if (!sel) return
  const counts = {}
  venues.forEach((v) => {
    counts[v.district] = (counts[v.district] || 0) + 1
  })
  const opts = ['<option value="">全部区县</option>']
  Object.keys(counts)
    .sort((a, b) => counts[b] - counts[a])
    .forEach((k) => {
      opts.push(`<option value="${esc(k)}">${esc(k)}（${counts[k]}）</option>`)
    })
  sel.innerHTML = opts.join('')
}

/* ---------------- 列表 ---------------- */

function renderList() {
  const box = $('list')
  if (!box) return
  const rows = []
  venues.forEach((v, i) => {
    if (!match(v)) return
    const k = KIND[v.type] || KIND.court
    rows.push(
      `<div class="item" data-i="${i}">` +
        `<i class="pin" style="background:${k.color};color:${k.color}"></i>` +
        `<div class="ib">` +
        `<div class="iname">${esc(v.name)}</div>` +
        `<div class="imeta">` +
        `<span>${esc(v.district)}</span>` +
        `<span class="chip" style="background:rgba(${k.rgb},.11);color:${k.color}">${k.label}</span>` +
        `</div></div></div>`,
    )
  })
  box.innerHTML = rows.length
    ? rows.join('')
    : '<div class="empty">没有符合条件的场馆<br>试着调整筛选条件或换个城市</div>'
  $('shownN').textContent = rows.length
  if (state.active >= 0) {
    const el = box.querySelector(`.item[data-i="${state.active}"]`)
    if (el) el.classList.add('active')
  }
}

export function renderLoading(text) {
  const box = $('list')
  if (box) {
    box.innerHTML =
      `<div class="skel"><i></i><i></i><i></i></div>` +
      `<div class="empty" style="padding-top:0">${esc(text || '正在检索…')}</div>`
  }
}

/* ---------------- 地图 ---------------- */

const pinSVG = (color) =>
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 26 34">' +
  `<path d="M13 32.4C13 32.4 24.6 20.2 24.6 12.6A11.6 11.6 0 1 0 1.4 12.6C1.4 20.2 13 32.4 13 32.4Z" fill="${color}" stroke="#ffffff" stroke-width="2"/>` +
  '<circle cx="13" cy="12.6" r="4.2" fill="#ffffff"/></svg>'

const clusterHTML = (n, rgb) =>
  '<div style="position:relative;width:48px;height:48px">' +
  `<div style="position:absolute;left:5px;top:5px;width:38px;height:38px;border-radius:50%;background:rgba(${rgb},0.15)"></div>` +
  `<div style="position:absolute;left:10.5px;top:10.5px;width:27px;height:27px;border-radius:50%;background:rgb(${rgb});` +
  'border:2.5px solid #fff;box-sizing:border-box;display:flex;align-items:center;justify-content:center;' +
  `color:#fff;font-size:11.5px;font-weight:700;font-family:system-ui,-apple-system,sans-serif;letter-spacing:-.3px">${n}</div></div>`

function clearMarkers() {
  for (let i = 0; i < markers.length; i++) markers[i].setMap(null)
  markers = []
}

function renderMarkers() {
  if (!map || !window.AMap) return
  const z = map.getZoom() || 9
  const degPerPx = 360 / (512 * Math.pow(2, z))
  const cell = 52 * degPerPx

  // 按屏幕像素网格聚合：同一个格子里的点合成一个数字气泡
  const groups = new Map()
  venues.forEach((v, i) => {
    if (!match(v)) return
    const key = Math.round(v.lat / cell) + '_' + Math.round(v.lng / cell)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(i)
  })

  clearMarkers()
  const fresh = []

  groups.forEach((arr) => {
    if (arr.length === 1) {
      const v = venues[arr[0]]
      const m = new window.AMap.Marker({
        position: [v.lng, v.lat],
        content: pinSVG((KIND[v.type] || KIND.court).color),
        anchor: 'bottom-center',
        zIndex: 100,
      })
      m.on('click', () => selectVenue(arr[0], false))
      fresh.push(m)
      return
    }
    let la = 0
    let ln = 0
    const cnt = { court: 0, gym: 0, train: 0 }
    arr.forEach((i) => {
      la += venues[i].lat
      ln += venues[i].lng
      cnt[venues[i].type] = (cnt[venues[i].type] || 0) + 1
    })
    la /= arr.length
    ln /= arr.length
    const main =
      cnt.court >= cnt.gym && cnt.court >= cnt.train ? 'court' : cnt.gym >= cnt.train ? 'gym' : 'train'
    const m = new window.AMap.Marker({
      position: [ln, la],
      content: clusterHTML(arr.length, KIND[main].rgb),
      anchor: 'center',
      zIndex: 120,
    })
    m.on('click', () => {
      map.setZoomAndCenter(Math.min((map.getZoom() || 9) + 2.2, 17), [ln, la], true)
    })
    fresh.push(m)
  })

  map.add(fresh)
  markers = fresh
}

function scheduleRender() {
  if (!markerTimer) {
    markerTimer = setTimeout(() => {
      markerTimer = null
      renderMarkers()
    }, 110)
  }
  if (!listTimer) {
    listTimer = setTimeout(() => {
      listTimer = null
      renderList()
    }, 140)
  }
}

/* ---------------- 信息窗与选中 ---------------- */

function infoHTML(v) {
  const k = KIND[v.type] || KIND.court
  const tel = v.tel
    ? `<div class="telrow"><span>电话</span><a href="tel:${esc(v.tel)}">${esc(v.tel)}</a></div>`
    : ''
  return (
    '<div class="iw">' +
    `<h3>${esc(v.name)}</h3>` +
    `<div class="sub"><span class="chip" style="background:rgba(${k.rgb},.11);color:${k.color}">${k.label}</span> ${esc(v.district)}</div>` +
    (v.address ? `<div class="addr">${esc(v.address)}</div>` : '') +
    tel +
    '</div>'
  )
}

export function selectVenue(i, fly) {
  const v = venues[i]
  if (!v) return
  state.active = i
  if (map && infoWindow) {
    infoWindow.setContent(infoHTML(v))
    infoWindow.open(map, [v.lng, v.lat])
    if (fly) {
      map.setCenter([v.lng, v.lat])
      map.setZoom(Math.max(map.getZoom() || 9, 14.5))
    }
  }
  const box = $('list')
  if (!box) return
  box.querySelectorAll('.item.active').forEach((el) => el.classList.remove('active'))
  const el = box.querySelector(`.item[data-i="${i}"]`)
  if (el) {
    el.classList.add('active')
    const r = el.getBoundingClientRect()
    const br = box.getBoundingClientRect()
    if (r.top < br.top || r.bottom > br.bottom) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }
  if (fly && isNarrow()) closeSheet()
}

/* ---------------- 视野自适应 ---------------- */

export function fitAll() {
  if (!map || !venues.length) return
  const size = map.getSize() || { width: 1200, height: 800 }
  const w = size.width || 1200

  if (w >= 760) {
    map.setFitView(markers.length ? markers : null, true, [70, 70, 70, 410], 15)
    return
  }

  let minLat = 90
  let maxLat = -90
  let minLng = 180
  let maxLng = -180
  venues.forEach((v) => {
    if (!match(v)) return
    minLat = Math.min(minLat, v.lat)
    maxLat = Math.max(maxLat, v.lat)
    minLng = Math.min(minLng, v.lng)
    maxLng = Math.max(maxLng, v.lng)
  })
  if (minLat > maxLat) return

  map.setBounds(new window.AMap.Bounds([minLng, minLat], [maxLng, maxLat]))
  const z = Math.max((map.getZoom() || 9) - 0.2, 6)
  map.setZoom(z)
  const dpp = 360 / (512 * Math.pow(2, z))
  const cLat = (minLat + maxLat) / 2
  const cLng = (minLng + maxLng) / 2
  const shift = ((SHEET_COVER / 2) * dpp * Math.cos((cLat * Math.PI) / 180))
  map.setCenter([cLng, cLat - shift])
}

/* ---------------- 移动端抽屉 ---------------- */

function openSheet() {
  const p = $('panel')
  if (p) p.classList.add('expanded')
}
function closeSheet() {
  const p = $('panel')
  if (p) p.classList.remove('expanded')
}

/* ---------------- 初始化 ---------------- */

export function initView({ onNeedKey }) {
  map = new window.AMap.Map('map', {
    center: [120.1, 30.25],
    zoom: 10,
    viewMode: '2D',
    resizeEnable: true,
    showLabel: true,
  })

  infoWindow = new window.AMap.InfoWindow({
    autoMove: true,
    offset: new window.AMap.Pixel(0, -32),
    content: '',
  })

  let zoomBucket = null
  map.on('zoomend', () => {
    const b = Math.round((map.getZoom() || 9) * 2)
    if (b !== zoomBucket) {
      zoomBucket = b
      scheduleRender()
    }
  })

  // 列表点击
  $('list').addEventListener('click', (e) => {
    const el = e.target.closest('.item')
    if (!el) return
    selectVenue(Number(el.dataset.i), true)
  })

  // 搜索框
  $('q').addEventListener('input', (e) => setFilter({ q: e.target.value }))

  // 区县
  $('dist').addEventListener('change', (e) => setFilter({ district: e.target.value }))

  // 类型分段
  $('typeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button')
    if (!b) return
    $('typeSeg').querySelectorAll('button').forEach((x) => x.classList.remove('on'))
    b.classList.add('on')
    setFilter({ type: b.dataset.t })
  })

  // 移动端抽屉
  const bar = $('sheetBar')
  if (bar) {
    bar.addEventListener('click', () => {
      const p = $('panel')
      if (!p) return
      p.classList.contains('expanded') ? closeSheet() : openSheet()
    })
  }

  if (onNeedKey) {
    const btn = $('btnKey')
    if (btn) btn.addEventListener('click', onNeedKey)
  }

  render()
}

export function getMap() {
  return map
}

export function resizeMap() {
  if (map) {
    try {
      map.resize()
    } catch {
      /* ignore */
    }
  }
}

export function render() {
  renderMarkers()
  renderList()
}

export function totalCount() {
  return venues.length
}
