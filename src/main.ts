import { MapReader } from './mapReader.js'

/** 地图资源：用 import.meta.url 解析，页面挂在任意路径下都能找到文件 */
const MAP_SOURCE = new URL('../maps/吞食天地.png', import.meta.url).href

const viewport = document.getElementById('viewport') as HTMLDivElement
const loading = document.getElementById('loading') as HTMLDivElement
const zoomLabel = document.getElementById('zoom-label') as HTMLSpanElement
const hint = document.getElementById('hint') as HTMLDivElement

const map = new MapReader(MAP_SOURCE)
viewport.appendChild(map.element)

// ---------------------------------------------------------------- 状态回显

const ZOOM_STEP = 1.35

const renderZoom = () => {
    zoomLabel.textContent = `${Math.round(map.scale * 100)}%`
}

map.element.addEventListener('mapready', () => {
    loading.classList.add('is-hidden')
    renderZoom()
}, { once: true })

map.element.addEventListener('maperror', (e) => {
    const { source } = (e as CustomEvent<{ source: string }>).detail
    loading.classList.add('is-error')
    loading.textContent = `地图加载失败：${source}`
})

map.element.addEventListener('mapchange', renderZoom)

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

// ---------------------------------------------------------------- 提示文字

const hideHint = () => hint.classList.add('is-hidden')
map.element.addEventListener('wheel', hideHint, { once: true, passive: true })
map.element.addEventListener('pointerdown', hideHint, { once: true })
