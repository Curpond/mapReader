import { MapReader } from './mapReader.js'
import { MarkerLayer } from './markerLayer.js'
import { MarkerPanel } from './markerPanel.js'
import { MarkerStore, createMarker, type MapMarker, type MarkerType } from './markerStore.js'

interface MapEntry {
    /** 地图名，默认取文件名（不含扩展名） */
    name: string
    /** maps/ 目录下的文件名（也是标签数据的键） */
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
const editButton = document.getElementById('marker-edit') as HTMLButtonElement

const map = new MapReader('')
viewport.appendChild(map.element)

// ---------------------------------------------------------------- 加载态与读数

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

// ---------------------------------------------------------------- 标签：数据与视图

const store = new MarkerStore()
const layer = new MarkerLayer(map)

let currentMap: MapEntry | null = null
let markers: MapMarker[] = []
let selectedId: string | null = null
let editing = false
// 记住上次用的形态和颜色，连续打标签更顺手
let lastType: MarkerType = 'star'
let lastColor = '#ffd166'

const panel = new MarkerPanel({
    onPatch: (patch) => patchSelected(patch),
    onDelete: () => deleteSelected(),
    onLocate: () => locateSelected(),
    onClose: () => closePanel(),
    onSelect: (id) => selectMarker(id),
    onExport: () => store.downloadBackup(),
})

store.onStatus = (state) => panel.setStatus(state)
document.body.append(panel.element, panel.tooltip)

const findMarker = (id: string | null) => (id ? markers.find((marker) => marker.id === id) ?? null : null)

const selectedMarker = () => findMarker(selectedId)

const persist = () => {
    if (!currentMap) return
    store.set(currentMap.file, markers)
    store.scheduleSave()
}

const refreshPanel = () => {
    const marker = selectedMarker()
    if (!marker) return
    if (editing) panel.showEditor(marker, { fitScale: map.fitScale, markers, selectedId })
    else panel.showInfo(marker)
}

const selectMarker = (id: string) => {
    selectedId = id
    layer.setSelected(id)
    const marker = findMarker(id)
    if (!marker) {
        panel.close()
        return
    }
    // 达到显示阈值才看得见，选中时顺手把视图放大到能看见
    if (marker.minScale > 0 && map.scale < marker.minScale) map.setScale(marker.minScale)
    refreshPanel()
}

const patchSelected = (patch: Partial<MapMarker>) => {
    const marker = selectedMarker()
    if (!marker) return
    Object.assign(marker, patch)
    // 下一次新建标签沿用这次的形态和颜色
    if (patch.type) lastType = patch.type
    if (patch.color) lastColor = patch.color
    layer.updateMarker(marker)
    if (editing) {
        panel.syncTitle(marker.title)
        if ('minScale' in patch) panel.updateList(markers, selectedId)
    }
    persist()
}

const deleteSelected = () => {
    const marker = selectedMarker()
    if (!marker) return
    markers = markers.filter((item) => item.id !== marker.id)
    selectedId = null
    layer.setMarkers(markers)
    layer.setSelected(null)
    panel.close()
    persist()
}

const locateSelected = () => {
    const marker = selectedMarker()
    if (!marker) return
    if (marker.minScale > 0 && map.scale < marker.minScale) map.setScale(marker.minScale)
    map.centerOn(marker.x, marker.y)
}

const closePanel = () => {
    selectedId = null
    layer.setSelected(null)
    panel.close()
}

const setEditing = (next: boolean) => {
    editing = next
    layer.setEditable(editing)
    editButton.classList.toggle('is-active', editing)
    editButton.setAttribute('aria-pressed', String(editing))
    document.body.classList.toggle('is-editing', editing)
    if (!editing) {
        closePanel()
    } else if (selectedMarker()) {
        refreshPanel()
    }
}

const addMarkerAt = (x: number, y: number) => {
    const marker = createMarker(x, y, { type: lastType, color: lastColor })
    markers = [...markers, marker]
    layer.setMarkers(markers)
    selectMarker(marker.id)
    persist()
}

layer.onHover = (marker, clientX, clientY) => {
    if (marker) panel.showTooltip(marker, clientX, clientY)
    else panel.hideTooltip()
}

layer.onActivate = (marker) => {
    selectMarker(marker.id)
    if (editing) {
        lastType = marker.type
        lastColor = marker.color
    }
}

layer.onCreate = (x, y) => addMarkerAt(x, y)

layer.onDeselect = () => {
    if (panel.mode === 'closed') return
    closePanel()
}

layer.onMove = (marker) => {
    layer.updateMarker(marker)
    persist()
}

// ---------------------------------------------------------------- 地图切换

const selectMap = (entry: MapEntry) => {
    currentMap = entry
    select.value = entry.file
    document.title = `${entry.name} · 地图阅读器`
    try {
        localStorage.setItem(STORAGE_KEY, entry.file)
    } catch {
        // 隐私模式下 localStorage 可能不可用，忽略即可
    }

    markers = store.list(entry.file)
    selectedId = null
    layer.setMarkers(markers)
    layer.setSelected(null)
    layer.setEditable(editing)
    panel.close()

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

    await store.load()

    select.textContent = ''
    for (const entry of maps) {
        const option = document.createElement('option')
        option.value = entry.file
        option.textContent = entry.name
        select.appendChild(option)
    }

    select.addEventListener('change', () => {
        const picked = maps.find((entry) => entry.file === select.value)
        if (picked && picked.file !== currentMap?.file) selectMap(picked)
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
editButton.addEventListener('click', () => setEditing(!editing))

// ---------------------------------------------------------------- 快捷键

window.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return

    // 正在输入框里打字时不要抢按键
    const target = e.target as HTMLElement | null
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement

    if (e.key === 'Escape') {
        if (editing && selectedId) closePanel()
        else if (editing) setEditing(false)
        else closePanel()
        return
    }

    if (typing) return

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
        case 'e':
        case 'E':
            setEditing(!editing)
            break
        case 'Delete':
        case 'Backspace':
            if (editing) deleteSelected()
            else return
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
