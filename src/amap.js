/**
 * 高德 JS API 2.0 动态加载。
 * 只有地图渲染 + 几个检索插件，不含任何业务逻辑。
 */
const PLUGINS = [
  'AMap.PlaceSearch',
  'AMap.CitySearch',
  'AMap.DistrictSearch',
  'AMap.Geolocation',
  'AMap.Geocoder',
].join(',')

let pending = null

export function loadAMap({ key, sec }) {
  if (window.AMap) return Promise.resolve(window.AMap)
  if (pending) return pending

  if (sec) {
    // 2021-12 之后创建的 Key 必须配安全密钥，否则报 INVALID_USER_SCODE
    window._AMapSecurityConfig = { securityJsCode: sec }
  }

  pending = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=${PLUGINS}`
    s.async = true
    s.onload = () => {
      if (!window.AMap) {
        reject(new Error('SDK 加载异常：请确认 Key 绑定的服务类型是「Web端(JS API)」'))
        return
      }
      resolve(window.AMap)
    }
    s.onerror = () => reject(new Error('无法加载高德 SDK，请检查网络或 Key 是否有效'))
    document.head.appendChild(s)
  })

  return pending
}
