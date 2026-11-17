# 羽毛球馆地图

按定位或手动选城市，检索该地区的羽毛球馆并在地图上查看。基于高德地图 POI 实时检索，不内置任何数据，也不内置任何 Key。

在线 Demo：**https://youguqiubai.github.io/badminton-map/**

![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=fff)
![License](https://img.shields.io/badge/License-MIT-green)

## 特性

- **城市级定位**：通过 IP 定位自动判断当前城市，也可以在输入框里直接换城市
- **实时检索**：数据来自高德 POI，不是写死的静态列表，任何城市都能查
- **突破 500 条上限**：高德单关键词最多返回约 500 条，超出时自动按区县分片补搜再合并去重
- **分类筛选**：自动把结果分为「羽毛球场 / 综合体育馆 / 培训机构」三类
- **地图聚合**：按屏幕像素网格聚合标记，缩放时自动重新分组，不会糊成一团
- **本地缓存**：结果缓存 24 小时，减少 API 调用；点「切换」可强制刷新
- **单页零后端**：纯静态，可部署到任意静态托管
- **Key 只存本地**：不经过任何服务器

## 快速开始

```bash
git clone https://github.com/youguqiubai/badminton-map.git
cd badminton-map
npm install
npm run dev
```

打开 http://127.0.0.1:5173

首次打开会弹窗要求填高德 Key，填完即可使用。

## 获取高德 Key

1. 打开 [高德开放平台控制台](https://console.amap.com/dev/key/app) 并登录
2. 「应用管理」→「创建新应用」
3. 添加 Key，**服务平台必须选「Web端 (JS API)」**
4. 复制 Key 和安全密钥（`securityJsCode`）填进弹窗

注意：2021 年 12 月之后创建的 Key 都需要配安全密钥，不填会报 `INVALID_USER_SCODE`。

个人开发者免费额度足够日常使用。Key 存在 `localStorage`，可以在弹窗里随时更换。

## 定位说明

浏览器原生的 GPS 定位（`navigator.geolocation`）**要求页面在 HTTPS 下**，本地 `localhost` 除外。

本项目默认用高德的 IP 定位（`AMap.CitySearch`），不需要 HTTPS，但精度只到城市级——能判断你在杭州还是上海，判断不到你在哪个区。

如果你部署在 HTTPS 域名下，可以改成 GPS 定位拿到精确位置，具体做法见 `src/search.js` 里的 `locateCity`。

## 构建与部署

```bash
npm run build     # 产物在 dist/
npm run preview   # 本地预览构建结果
```

`vite.config.js` 里 `base: './'`，产物用相对路径，所以可以直接扔进任意子目录。

常见部署方式：

**Nginx**
```nginx
location /badminton/ {
    alias /var/www/badminton/;
    index index.html;
    gzip on;
    gzip_types text/css application/javascript application/json;
}
```

**Vercel / Netlify / Cloudflare Pages**
连接仓库，构建命令填 `npm run build`，输出目录填 `dist`。

**GitHub Pages**

仓库已内置 `.github/workflows/deploy.yml`：推送到 `main` 分支后自动构建并发布。

首次使用需在仓库 **Settings → Pages → Build and deployment → Source** 里选 **GitHub Actions**，之后每次 push 都会更新在线 Demo。

## 项目结构

```
src/
├── main.js       入口：Key 弹窗、城市切换、检索编排
├── config.js     Key 的本地存取
├── amap.js       高德 SDK 动态加载
├── search.js     POI 检索：分类、分页、分片、去重、缓存
├── view.js       地图标记、聚合、信息窗、列表、统计
└── style.css     全部样式
```

数据流：

```
定位 / 手动输入城市
      ↓
searchCity()  ── 整城搜 10 页（≤500 条）
      ↓              ↓ 若 count 超 500
      │         按区县分片补搜
      ↓              ↓
      └──── 按 POI ID 去重 ────→ 归一化字段
                                  ↓
                            setVenues() → 地图 + 列表
```

## 数据与合规

**本项目不包含任何场馆数据**，所有 POI 均在运行时通过高德 API 查询。

请遵守[高德开放平台服务条款](https://lbs.amap.com/home/terms)：

- 不要将检索结果转存为数据库或数据集对外分发
- 不要绕过配额限制批量抓取
- 本地 24 小时缓存仅用于减少重复请求，不构成数据转存

商业使用请自行确认高德的服务条款与授权范围。

## 已知限制

- 定位精度只到城市级（见上文）
- 超过 500 家场馆的城市需要分片补搜，首次检索会比较慢（杭州约 5–8 秒）
- 高德 POI 收录完整度因城市而异，小城市可能只有几十家
- 场馆营业状态、价格、场地数量不在 POI 数据里，需要另外获取
- 只按「羽毛球馆」一个关键词检索，部分综合体育馆可能被遗漏

## 致谢

界面与聚合逻辑参考了原杭州羽毛球地图项目。

## License

[MIT](LICENSE)
