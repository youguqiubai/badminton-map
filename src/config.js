/**
 * 高德 Key 的本地存取。
 * 设计原则：仓库不内置任何 Key，用户首次访问时自行填写，只存 localStorage。
 */
const K_KEY = 'bm.amap.key'
const K_SEC = 'bm.amap.sec'

export function getCreds() {
  try {
    return {
      key: localStorage.getItem(K_KEY) || '',
      sec: localStorage.getItem(K_SEC) || '',
    }
  } catch {
    return { key: '', sec: '' }
  }
}

export function hasCreds() {
  return !!getCreds().key
}

export function saveCreds(key, sec) {
  try {
    localStorage.setItem(K_KEY, (key || '').trim())
    localStorage.setItem(K_SEC, (sec || '').trim())
  } catch {
    /* 隐私模式下 localStorage 可能不可写，忽略 */
  }
}

export function clearCreds() {
  try {
    localStorage.removeItem(K_KEY)
    localStorage.removeItem(K_SEC)
  } catch {
    /* ignore */
  }
}
