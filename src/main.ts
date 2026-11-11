import { ContextMenu, type MenuItem } from './contextMenu.js'
import { nameOfKey, MapViewport, type MapNode } from './mapViewport.js'
import { MarkerPanel } from './markerPanel.js'
import { MarkerStore, createMarker, type MapMarker, type MarkerType } from './markerStore.js'
import { SubmapWindow } from './submapWindow.js'

interface MapEntry {
    /** 显示名，默认取文件名（不含扩展名） */
    name: string
    /** 主地图是 maps/ 下的文件名；子地图是相对 maps/ 的路径（sub/xxx.png） */
    file: string
}

interface MapManifest {
    maps: MapEntry[]
    submaps?: MapEntry[]
}

/** 资源统一用 import.meta.url 解析：页面挂在任意路径下都能找到文件 */
const MANIFEST_URL = new URL('../maps/manifest.json', import.meta.url)
/** 支持 sub/xxx.png 这样的子目录路径 */
const mapUrl = (key: string) =>
    new URL(`../maps/${key.split('/').map(encodeURIComponent).join('/')}`, import.meta.url).href

const STORAGE_KEY = 'mapReader.lastMap'
const ZOOM_STEP = 1.35

const viewportEl = document.getElementById('viewport') as HTMLDivElement
const select = document.getElementById('map-select') as HTMLSelectElement
const crumbsEl = document.getElementById('crumbs') as HTMLDivElement
const loading = document.getElementById('loading') as HTMLDivElement
const zoomLabel = document.getElementById('zoom-label') as HTMLSpanElement
const hint = document.getElementById('hint') as HTMLDivElement
const editButton = document.getElementById('marker-edit') as HTMLButtonElement

// ---------------------------------------------------------------- 状态

const store = new MarkerStore()
const menu = new ContextMenu()
document.body.appendChild(menu.element)

let submaps: MapNode[] = []
/** 当前视图（导航栈顶）对应的地图 key，以及它手上的标签数组（编辑直接改它） */
let liveKey = ''
let markers: MapMarker[] = []
let selectedId: string | null = null
let editing = false
let lastType: MarkerType = 'star'
let lastColor = '#ffd166'

const markersFor = (key: string): MapMarker[] => (key === liveKey ? markers : store.list(key))

// ---------------------------------------------------------------- 视图

const viewport = new MapViewport({
    container: viewportEl,
    urlOf: mapUrl,
    getMarkers: markersFor,
    onStackChange: (stack) => {
        syncMarkersWithStack()
        renderCrumbs(stack)
        renderZoom()
    },
    onHover: (marker, x, y) => {
        if (marker) panel.showTooltip(marker, x, y)
        else panel.hideTooltip()
    },
    onActivate: (marker) => selectMarker(marker.id),
    onCreate: (x, y) => addMarkerAt(x, y),
    onDeselect: () => {
        if (panel.mode !== 'closed') closePanel()
    },
    onMove: (marker) => {
        viewport.layer.updateMarker(marker)
        persist()
    },
    onContextMenu: (marker, x, y) => openMarkerMenu(marker, x, y),
    onLoadError: (key, source) => {
        showError(`地图加载失败：${nameOfKey(key) || source}`)
    },
})

const map = viewport.map

// ---------------------------------------------------------------- 标签面板

const panel = new MarkerPanel({
    onPatch: (patch) => patchSelected(patch),
    onDelete: () => deleteSelected(),
    onLocate: () => locateSelected(),
    onClose: () => closePanel(),
    onSelect: (id) => selectMarker(id),
    onExport: () => store.downloadBackup(),
    onEnter: () => enterSelectedSubmap(),
    onPreview: () => previewSelectedSubmap(),
})
store.onStatus = (state) => panel.setStatus(state)
document.body.append(panel.element, panel.tooltip)

// ---------------------------------------------------------------- 浮窗预览

const submapWindow = new SubmapWindow({
    urlOf: mapUrl,
    getMarkers: (key) => store.list(key),
    onOpenInMain: (node) => {
        if (node.key === viewport.current?.key) return
        // 浮窗里钻到哪一层，主视图就从哪一层接着看
        viewport.enter(node)
        closePanel()
    },
    onHover: (marker, x, y) => {
        if (marker) panel.showTooltip(marker, x, y)
        else panel.hideTooltip()
    },
    onContextMenu: (marker, x, y) => openFloatMenu(marker, x, y),
})
document.body.appendChild(submapWindow.element)

// ---------------------------------------------------------------- 加载态

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

const renderZoom = () => {
    zoomLabel.textContent = `${Math.round(map.scale * 100)}%`
}

map.element.addEventListener('mapload', () => {
    if (viewport.depth > 0) showLoading('正在加载地图…')
})
map.element.addEventListener('mapready', () => {
    loading.classList.add('is-hidden')
    renderZoom()
})
map.element.addEventListener('mapchange', renderZoom)

// ---------------------------------------------------------------- 面包屑

const renderCrumbs = (stack: readonly MapNode[]) => {
    crumbsEl.textContent = ''
    crumbsEl.hidden = stack.length <= 1
    if (stack.length <= 1) return

    stack.forEach((node, index) => {
        if (index > 0) {
            const separator = document.createElement('span')
            separator.className = 'crumbs__sep'
            separator.textContent = '›'
            crumbsEl.appendChild(separator)
        }
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'crumbs__item'
        if (index === stack.length - 1) button.classList.add('is-current')
        button.textContent = node.name
        button.title = node.key
        button.addEventListener('click', () => {
            closePanel()
            viewport.goTo(index + 1)
        })
        crumbsEl.appendChild(button)
    })
}

// ---------------------------------------------------------------- 标签数据

const syncMarkersWithStack = () => {
    const key = viewport.current?.key ?? ''
    if (key === liveKey) return
    liveKey = key
    markers = store.list(key)
    selectedId = null
}

const findMarker = (id: string | null) => (id ? markers.find((marker) => marker.id === id) ?? null : null)
const selectedMarker = () => findMarker(selectedId)

const persist = () => {
    if (!liveKey) return
    store.set(liveKey, markers)
    store.scheduleSave()
}

const refreshPanel = () => {
    const marker = selectedMarker()
    if (!marker) return
    if (editing) panel.showEditor(marker, { fitScale: map.fitScale, markers, selectedId, submaps })
    else panel.showInfo(marker)
}

const selectMarker = (id: string) => {
    selectedId = id
    viewport.layer.setSelected(id)
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
    viewport.layer.updateMarker(marker)
    if (editing) {
        panel.syncTitle(marker.title)
        if ('minScale' in patch || 'submap' in patch) panel.updateList(markers, selectedId)
    }
    persist()
}

const deleteSelected = () => {
    const marker = selectedMarker()
    if (!marker) return
    markers = markers.filter((item) => item.id !== marker.id)
    selectedId = null
    viewport.layer.setMarkers(markers)
    viewport.layer.setSelected(null)
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
    viewport.layer.setSelected(null)
    panel.close()
}

const setEditing = (next: boolean) => {
    editing = next
    viewport.layer.setEditable(editing)
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
    viewport.layer.setMarkers(markers)
    selectMarker(marker.id)
    persist()
}

// ---------------------------------------------------------------- 子地图

const enterSelectedSubmap = () => {
    const marker = selectedMarker()
    if (!marker?.submap) return
    closePanel()
    viewport.enter({ key: marker.submap, name: nameOfKey(marker.submap) })
}

const previewSelectedSubmap = () => {
    const marker = selectedMarker()
    if (!marker?.submap) return
    submapWindow.open({ key: marker.submap, name: nameOfKey(marker.submap) })
}

const enterSubmapOf = (marker: MapMarker) => {
    if (!marker.submap) return
    closePanel()
    viewport.enter({ key: marker.submap, name: nameOfKey(marker.submap) })
}

const goBack = () => {
    closePanel()
    return viewport.back()
}

// ---------------------------------------------------------------- 右键菜单

/** 视口坐标 → 图片像素坐标 */
const imagePointOf = (clientX: number, clientY: number) => {
    const rect = map.element.getBoundingClientRect()
    const view = map.view
    return {
        x: Math.round(((clientX - rect.left - view.x) / view.scale) * 10) / 10,
        y: Math.round(((clientY - rect.top - view.y) / view.scale) * 10) / 10,
    }
}

const copyText = (text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => {
        // 剪贴板不可用就算了，不影响主流程
    })
}

const openMarkerMenu = (marker: MapMarker | null, x: number, y: number) => {
    if (!marker) {
        const point = imagePointOf(x, y)
        const items: MenuItem[] = []
        if (editing) {
            items.push({
                label: '在此新建标签',
                icon: '＋',
                hint: `${point.x}, ${point.y}`,
                onSelect: () => addMarkerAt(point.x, point.y),
            })
            items.push({ separator: true })
        }
        items.push({ label: '适应窗口（全图）', icon: '⤢', onSelect: () => map.fit() })
        items.push({
            label: editing ? '退出编辑模式' : '进入编辑模式',
            icon: '✎',
            hint: 'E',
            onSelect: () => setEditing(!editing),
        })
        items.push({
            label: '复制此处坐标',
            icon: '⌖',
            hint: `${point.x}, ${point.y}`,
            onSelect: () => copyText(`${point.x}, ${point.y}`),
        })
        menu.open({ x, y, title: '地图', items })
        return
    }

    const items: MenuItem[] = [
        { label: '查看信息卡', icon: 'ⓘ', onSelect: () => selectMarker(marker.id) },
        {
            label: marker.submap ? `进入此地图（${nameOfKey(marker.submap)}）` : '进入此地图',
            icon: '⤵',
            disabled: !marker.submap,
            hint: marker.submap ? '' : '未设置子地图',
            onSelect: () => enterSubmapOf(marker),
        },
        {
            label: '在浮窗中预览',
            icon: '❐',
            disabled: !marker.submap,
            onSelect: () => {
                if (marker.submap) submapWindow.open({ key: marker.submap, name: nameOfKey(marker.submap) })
            },
        },
        { separator: true },
        { label: '编辑此标签', icon: '✎', onSelect: () => { setEditing(true); selectMarker(marker.id) } },
        { label: '复制坐标', icon: '⌖', hint: `${marker.x}, ${marker.y}`, onSelect: () => copyText(`${marker.x}, ${marker.y}`) },
        { separator: true },
        { label: '删除此标签', icon: '🗑', danger: true, onSelect: () => { selectMarker(marker.id); deleteSelected() } },
    ]
    menu.open({ x, y, title: marker.title || '未命名', items })
}

const openFloatMenu = (marker: MapMarker | null, x: number, y: number) => {
    const current = submapWindow.isOpen ? '子地图' : '地图'
    const items: MenuItem[] = []
    if (marker) {
        items.push({ label: '查看信息卡', icon: 'ⓘ', onSelect: () => selectMarker(marker.id) })
        items.push({
            label: marker.submap ? `在小窗中进入（${nameOfKey(marker.submap)}）` : '进入此地图',
            icon: '⤵',
            disabled: !marker.submap,
            onSelect: () => {
                if (marker.submap) submapWindow.open({ key: marker.submap, name: nameOfKey(marker.submap) })
            },
        })
        items.push({ separator: true })
    }
    items.push({ label: '在主视图中打开当前子地图', icon: '⤢', onSelect: () => {
        const node = viewport.current
        if (node && submapWindow.isOpen) {
            submapWindow.close()
            viewport.enter(node)
        }
    } })
    items.push({ label: '关闭浮窗', icon: '×', onSelect: () => submapWindow.close() })
    menu.open({ x, y, title: current, items })
}

// ---------------------------------------------------------------- 地图切换

const selectMap = (entry: MapEntry) => {
    document.title = `${entry.name} · 地图阅读器`
    try {
        localStorage.setItem(STORAGE_KEY, entry.file)
    } catch {
        // 隐私模式下 localStorage 可能不可用，忽略即可
    }
    closePanel()
    viewport.open({ key: entry.file, name: entry.name })
}

const readManifest = async (): Promise<{ maps: MapEntry[]; submaps: MapNode[] }> => {
    const response = await fetch(MANIFEST_URL, { cache: 'no-cache' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const manifest = (await response.json()) as MapManifest
    const maps = Array.isArray(manifest.maps)
        ? manifest.maps.filter((entry) => typeof entry?.file === 'string' && entry.file)
        : []
    const subs = Array.isArray(manifest.submaps)
        ? manifest.submaps
            .filter((entry) => typeof entry?.file === 'string' && entry.file)
            .map((entry) => ({ key: entry.file, name: entry.name || nameOfKey(entry.file) }))
        : []
    return { maps, submaps: subs }
}

const bootstrap = async () => {
    showLoading('正在读取地图清单…')

    let manifest: { maps: MapEntry[]; submaps: MapNode[] }
    try {
        manifest = await readManifest()
    } catch (err) {
        showError(`地图清单读取失败（start.bat 会自动生成，也可手动执行 npm run maps）：${String(err)}`)
        return
    }

    submaps = manifest.submaps
    if (manifest.maps.length === 0) {
        showError('maps/ 目录里还没有图片，放一张地图图片后重新启动')
        return
    }

    await store.load()

    select.textContent = ''
    for (const entry of manifest.maps) {
        const option = document.createElement('option')
        option.value = entry.file
        option.textContent = entry.name
        select.appendChild(option)
    }

    select.addEventListener('change', () => {
        const picked = manifest.maps.find((entry) => entry.file === select.value)
        if (picked && picked.file !== viewport.current?.key) selectMap(picked)
    })

    // 优先恢复上次看的地图
    let remembered: string | null = null
    try {
        remembered = localStorage.getItem(STORAGE_KEY)
    } catch {
        remembered = null
    }
    const initial = manifest.maps.find((entry) => entry.file === remembered) ?? manifest.maps[0]!
    selectMap(initial)

    // 只有一张地图时选择器没有意义
    select.disabled = manifest.maps.length < 2
}

// ---------------------------------------------------------------- 工具条

document.getElementById('zoom-in')!.addEventListener('click', () => map.zoomBy(ZOOM_STEP))
document.getElementById('zoom-out')!.addEventListener('click', () => map.zoomBy(1 / ZOOM_STEP))
document.getElementById('zoom-fit')!.addEventListener('click', () => map.fit())
editButton.addEventListener('click', () => setEditing(!editing))

// ---------------------------------------------------------------- 快捷键

window.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return

    const target = e.target as HTMLElement | null
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement

    if (e.key === 'Escape') {
        if (menu.isOpen) return // 菜单自己处理
        if (submapWindow.isOpen) {
            submapWindow.close()
            return
        }
        if (panel.mode !== 'closed') {
            closePanel()
            return
        }
        if (viewport.depth > 1) {
            goBack()
            return
        }
        if (editing) setEditing(false)
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
        case 'Backspace':
            if (viewport.depth > 1) goBack()
            else return
            break
        case 'Delete':
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
