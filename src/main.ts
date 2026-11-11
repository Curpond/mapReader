import { MapReader } from './mapReader.js'

interface MapEntry {
    /** 地图名，默认取文件名（不含扩展名） */
    name: string
    /** maps/ 目录下的文件名 */
    file: string
}

interface MapManifest {
    maps: MapEntry[]
}

/** 资源统一用 import.meta.url 解析：页面挂在任意路径下都能找到文件 */
const MANIFEST_URL = new URL('../maps/manifest.json', import.meta.url)
const mapUrl = (file: string) => new URL(`../maps/${encodeURIComponent(file)}`, import.meta.url).href

const STORAGE_KEY = 'mapReader.lastMap'
const ZOOM_STEP = 1.35

const viewport = document.getElementById('viewport') as HTMLDivElement
const select = document.getElementById('map-select') as HTMLSelectElement
const loading = document.getElementById('loading') as HTMLDivElement
const zoomLabel = document.getElementById('zoom-label') as HTMLSpanElement
const hint = document.getElementById('hint') as HTMLDivElement

const map = new MapReader('')
viewport.appendChild(map.element)

// ---------------------------------------------------------------- 视图状态回显

const renderZoom = () => {
    zoomLabel.textContent = `${Math.round(map.scale * 100)}%`
}

const showLoading = (text: string) => {
    loading.textContent = ''
    loading.classList.remove('is-hidden', 'is-error')
    const spinner = document.createElement('div')
    spinner.className = 'loading__spinner'
    spinner.setAttribute('aria-hidden', 'true')
    const label = document.createElement('p')
    label.className = 'loading__text'
    label.textContent = text
    loading.append(spinner, label)
}

const showError = (text: string) => {
    loading.classList.remove('is-hidden')
    loading.classList.add('is-error')
    loading.textContent = text
}

map.element.addEventListener('mapload', () => showLoading('正在加载地图…'))

map.element.addEventListener('mapready', () => {
    loading.classList.add('is-hidden')
    renderZoom()
})

map.element.addEventListener('mapchange', renderZoom)

map.element.addEventListener('maperror', (e) => {
    const { source } = (e as CustomEvent<{ source: string }>).detail
    showError(`地图加载失败：${source}`)
})

// ---------------------------------------------------------------- 地图切换

let current: MapEntry | null = null

const selectMap = (entry: MapEntry) => {
    current = entry
    select.value = entry.file
    document.title = `${entry.name} · 地图阅读器`
    try {
        localStorage.setItem(STORAGE_KEY, entry.file)
    } catch {
        // 隐私模式下 localStorage 可能不可用，忽略即可
    }
    map.load(mapUrl(entry.file))
}

const readManifest = async (): Promise<MapEntry[]> => {
    const response = await fetch(MANIFEST_URL, { cache: 'no-cache' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const manifest = (await response.json()) as MapManifest
    return Array.isArray(manifest.maps)
        ? manifest.maps.filter((entry) => typeof entry?.file === 'string' && entry.file)
        : []
}

const bootstrap = async () => {
    showLoading('正在读取地图清单…')

    let maps: MapEntry[]
    try {
        maps = await readManifest()
    } catch (err) {
        showError(`地图清单读取失败（npm start 会自动生成，也可手动执行 npm run maps）：${String(err)}`)
        return
    }

    if (maps.length === 0) {
        showError('maps/ 目录里还没有图片，放一张地图图片后重新运行 npm start')
        return
    }

    select.textContent = ''
    for (const entry of maps) {
        const option = document.createElement('option')
        option.value = entry.file
        option.textContent = entry.name
        select.appendChild(option)
    }

    select.addEventListener('change', () => {
        const picked = maps.find((entry) => entry.file === select.value)
        if (picked && picked.file !== current?.file) selectMap(picked)
    })

    // 优先恢复上次看的地图
    let remembered: string | null = null
    try {
        remembered = localStorage.getItem(STORAGE_KEY)
    } catch {
        remembered = null
    }
    const initial = maps.find((entry) => entry.file === remembered) ?? maps[0]!
    selectMap(initial)

    // 只有一张地图时选择器没有意义
    select.disabled = maps.length < 2
}

// ---------------------------------------------------------------- 工具条

document.getElementById('zoom-in')!.addEventListener('click', () => map.zoomBy(ZOOM_STEP))
document.getElementById('zoom-out')!.addEventListener('click', () => map.zoomBy(1 / ZOOM_STEP))
document.getElementById('zoom-fit')!.addEventListener('click', () => map.fit())

// ---------------------------------------------------------------- 快捷键

window.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    switch (e.key) {
        case '+':
        case '=':
            map.zoomBy(ZOOM_STEP)
            break
        case '-':
        case '_':
            map.zoomBy(1 / ZOOM_STEP)
            break
        case '0':
            map.fit()
            break
        default:
            return
    }
    e.preventDefault()
})

// ---------------------------------------------------------------- 操作提示

const hideHint = () => hint.classList.add('is-hidden')
map.element.addEventListener('wheel', hideHint, { once: true, passive: true })
map.element.addEventListener('pointerdown', hideHint, { once: true })

void bootstrap()
