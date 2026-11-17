import './style.css'
import { getCreds, hasCreds, saveCreds } from './config.js'
import { loadAMap } from './amap.js'
import { searchCity, locateCity, clearCache } from './search.js'
import * as view from './view.js'

const $ = (id) => document.getElementById(id)
const LAST_CITY = 'bm.lastcity'
const DEFAULT_CITY = '杭州'

let booted = false
let searching = false
let currentCity = ''

/* ---------------- 提示 ---------------- */

function showNotice(title, detail) {
  const el = $('keynotice')
  if (!el) return
  el.querySelector('.kt').textContent = title
  el.querySelector('.kd').textContent = detail || ''
  el.classList.add('show')
}
function hideNotice() {
  const el = $('keynotice')
  if (el) el.classList.remove('show')
}

/* ---------------- Key 弹窗 ---------------- */

function openKeyModal(prefill) {
  const c = prefill || getCreds()
  $('keyInput').value = c.key || ''
  $('secInput').value = c.sec || ''
  $('keyModal').classList.add('show')
  setTimeout(() => $('keyInput').focus(), 60)
}
function closeKeyModal() {
  $('keyModal').classList.remove('show')
}

/* ---------------- 城市标题 ---------------- */

function setCityLabel(city, loading) {
  const name = city || '定位中'
  $('cityName').textContent = name
  const sb = $('sbCity')
  if (sb) sb.textContent = name + '羽毛球馆'
  document.title = `${name}羽毛球馆地图${loading ? ' · 加载中' : ''}`

  // 城市写进 URL，方便分享
  try {
    const u = new URL(location.href)
    if (city) u.searchParams.set('city', city)
    else u.searchParams.delete('city')
    history.replaceState(null, '', u)
  } catch {
    /* ignore */
  }
}

function readCityFromUrl() {
  try {
    return new URLSearchParams(location.search).get('city') || ''
  } catch {
    return ''
  }
}

function rememberCity(city) {
  try {
    localStorage.setItem(LAST_CITY, city)
  } catch {
    /* ignore */
  }
}

/* ---------------- 检索 ---------------- */

async function goto(city, opts = {}) {
  const name = (city || '').trim()
  if (!name) return
  if (searching) return

  searching = true
  currentCity = name
  setCityLabel(name, true)
  view.renderLoading(`正在检索「${name}」的羽毛球馆…`)
  setBusy(true)

  if (opts.force) clearCache(name)

  try {
    const { venues, fromCache } = await searchCity(name, (loaded, total, scope) => {
      const tail = total ? `已取 ${loaded}/${total}` : ''
      view.renderLoading(`正在检索 ${scope} ${tail}`)
    })

    if (!venues.length) {
      view.setVenues([])
      setCityLabel(name, false)
      showNotice('没找到场馆', `「${name}」没有检索到羽毛球馆。换个城市名试试，比如「上海」「成都」。`)
    } else {
      hideNotice()
      view.setVenues(venues)
      setCityLabel(name, false)
      rememberCity(name)
      if (fromCache) showNotice('已使用本地缓存', '数据缓存 24 小时，点「切换」可强制重新检索。')
      else hideNotice()
      setTimeout(() => view.fitAll(), 260)
    }
  } catch (e) {
    setCityLabel(name, false)
    showNotice('检索失败', e.message || String(e))
  } finally {
    searching = false
    setBusy(false)
  }
}

function setBusy(on) {
  ;['btnLocate', 'btnCity', 'btnKey'].forEach((id) => {
    const b = $(id)
    if (b) b.classList.toggle('loading', on)
  })
}

/* ---------------- 定位 ---------------- */

async function doLocate() {
  if (searching) return
  setBusy(true)
  view.renderLoading('正在定位当前城市…')
  const r = await locateCity()
  setBusy(false)
  if (r.ok && r.city) {
    const city = r.city.replace(/市$/, '')
    $('cityInput').value = city
    await goto(city)
  } else {
    showNotice('定位失败', '可能被浏览器或网络拦截。直接在上方输入城市名即可。')
    $('cityInput').focus()
  }
}

/* ---------------- 启动 ---------------- */

async function boot() {
  const creds = getCreds()
  if (!creds.key) {
    openKeyModal()
    return
  }

  try {
    await loadAMap(creds)
  } catch (e) {
    showNotice('地图加载失败', e.message)
    openKeyModal(creds)
    return
  }

  if (!booted) {
    try {
      view.initView({ onNeedKey: () => openKeyModal() })
    } catch (e) {
      showNotice('地图初始化失败', String((e && e.message) || e))
      return
    }
    booted = true
  }

  const fromUrl = readCityFromUrl()
  const last = (() => {
    try {
      return localStorage.getItem(LAST_CITY) || ''
    } catch {
      return ''
    }
  })()

  if (fromUrl) {
    $('cityInput').value = fromUrl
    goto(fromUrl)
    return
  }

  // 先尝试 IP 定位，失败则退回上次城市或默认城市
  view.renderLoading('正在定位当前城市…')
  const r = await locateCity()
  if (r.ok && r.city) {
    const city = r.city.replace(/市$/, '')
    $('cityInput').value = city
    goto(city)
  } else {
    const city = last || DEFAULT_CITY
    $('cityInput').value = city
    goto(city)
  }
}

/* ---------------- 事件 ---------------- */

function bindUI() {
  $('btnLocate').addEventListener('click', doLocate)

  $('btnCity').addEventListener('click', () => {
    const v = $('cityInput').value.trim()
    if (!v) {
      $('cityInput').focus()
      return
    }
    // 输入的城市可能和当前一样，此时强制刷新
    goto(v, { force: v === currentCity })
  })

  $('cityInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btnCity').click()
  })

  $('btnKey').addEventListener('click', () => openKeyModal())

  $('keySave').addEventListener('click', async () => {
    const k = $('keyInput').value.trim()
    const s = $('secInput').value.trim()
    if (!k) {
      $('keyInput').focus()
      return
    }
    saveCreds(k, s)
    closeKeyModal()
    await boot()
  })

  $('keyCancel').addEventListener('click', () => {
    if (hasCreds()) closeKeyModal()
    else showNotice('还没有配置 Key', '没有高德 Key 就无法检索场馆。点右下角齿轮可以随时配置。')
  })

  $('keyModal').addEventListener('click', (e) => {
    if (e.target.id === 'keyModal' && hasCreds()) closeKeyModal()
  })

  window.addEventListener('resize', () => {
    view.resizeMap()
  })
}

bindUI()
boot()
