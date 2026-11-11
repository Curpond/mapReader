/**
 * 标签渲染层。
 *
 * 关键设计：
 * 1) 覆盖层与图片共用同一条 transform（translate + scale），每帧只写一次样式；
 * 2) 标签内部用 scale(1/scale) 反向缩放，所以无论放多大，图标和文字都是恒定大小，
 *    不会跟着地图一起变成巨型文字（具体换算见 style.css 里 .marker__body 的说明）；
 * 3) 坐标一律是图片原始像素，落在覆盖层里就是 left/top。
 */
import type { MapReader } from './mapReader.js'
import type { MapMarker } from './markerStore.js'

const roundCoord = (value: number) => Math.round(value * 10) / 10

export class MarkerLayer {
    readonly element: HTMLDivElement

    #map: MapReader
    #items: MapMarker[] = []
    #nodes = new Map<string, HTMLDivElement>()
    #editable = false
    #selectedId: string | null = null
    #hidden = false
    #lastScale = -1
    #downAt: { x: number; y: number } | null = null
    /** 刚刚拖动过标记：用来吃掉拖动结束时那次额外的 click */
    #dragged = false

    onHover?: (marker: MapMarker | null, clientX: number, clientY: number) => void
    onActivate?: (marker: MapMarker) => void
    onCreate?: (x: number, y: number) => void
    onDeselect?: () => void
    onMove?: (marker: MapMarker) => void

    constructor(map: MapReader) {
        this.#map = map

        this.element = document.createElement('div')
        this.element.className = 'marker-layer'
        this.element.style.cssText = [
            'position: absolute',
            'top: 0',
            'left: 0',
            'width: 0',
            'height: 0',
            'transform-origin: 0 0',
            'pointer-events: none',
            'z-index: 3',
        ].join(';')
        map.element.appendChild(this.element)

        map.element.addEventListener('mapchange', this.#onViewChange)
        map.element.addEventListener('pointerdown', this.#onMapPointerDown)
        map.element.addEventListener('click', this.#onMapClick)
        this.sync()
    }

    setMarkers(markers: MapMarker[]) {
        this.#items = markers
        this.#rebuild()
    }

    setEditable(editable: boolean) {
        this.#editable = editable
        this.element.classList.toggle('is-editable', editable)
    }

    setHidden(hidden: boolean) {
        this.#hidden = hidden
        this.element.style.display = hidden ? 'none' : ''
    }

    setSelected(id: string | null) {
        if (this.#selectedId === id) return
        if (this.#selectedId) this.#nodes.get(this.#selectedId)?.classList.remove('is-selected')
        this.#selectedId = id
        if (id) this.#nodes.get(id)?.classList.add('is-selected')
    }

    /** 局部更新（改标题/颜色时不必重建整层，避免悬停闪烁） */
    updateMarker(marker: MapMarker) {
        const index = this.#items.findIndex((item) => item.id === marker.id)
        if (index >= 0) this.#items[index] = marker
        const node = this.#nodes.get(marker.id)
        if (node) this.#applyMarkerStyle(node, marker)
    }

    /** 与地图视图对齐：一次写样式，只在缩放变化时处理可见性 */
    sync() {
        const view = this.#map.view
        this.element.style.transform = `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`
        this.element.style.setProperty('--marker-inv', String(1 / view.scale))
        if (view.scale !== this.#lastScale) {
            this.#lastScale = view.scale
            this.#applyVisibility(view.scale)
        }
    }

    destroy() {
        this.#map.element.removeEventListener('mapchange', this.#onViewChange)
        this.#map.element.removeEventListener('pointerdown', this.#onMapPointerDown)
        this.#map.element.removeEventListener('click', this.#onMapClick)
        this.element.remove()
        this.#nodes.clear()
    }

    // ------------------------------------------------------------ 内部

    #onViewChange = () => {
        this.sync()
    }

    #rebuild() {
        this.element.textContent = ''
        this.#nodes.clear()

        const fragment = document.createDocumentFragment()
        for (const marker of this.#items) {
            const node = document.createElement('div')
            node.className = 'marker'
            node.dataset.id = marker.id

            const body = document.createElement('div')
            body.className = 'marker__body'

            if (marker.type === 'star') {
                const icon = document.createElement('span')
                icon.className = 'marker__icon'
                icon.textContent = '★'
                body.appendChild(icon)
            }

            const title = document.createElement('span')
            title.className = 'marker__title'
            title.textContent = marker.title
            body.appendChild(title)

            node.appendChild(body)
            this.#applyMarkerStyle(node, marker)

            node.addEventListener('pointerenter', (e) => {
                if (node.classList.contains('is-hidden')) return
                this.onHover?.(marker, e.clientX, e.clientY)
            })
            node.addEventListener('pointerleave', () => {
                this.onHover?.(null, 0, 0)
            })
            node.addEventListener('pointerdown', (e) => this.#onMarkerPointerDown(e, marker, node))
            node.addEventListener('click', (e) => {
                e.stopPropagation()
                // 拖动结束的那次点击不算点击
                if (this.#dragged) {
                    this.#dragged = false
                    return
                }
                this.onActivate?.(marker)
            })

            this.#nodes.set(marker.id, node)
            fragment.appendChild(node)
        }

        this.element.appendChild(fragment)
        this.#lastScale = -1
        this.sync()
    }

    #applyMarkerStyle(node: HTMLDivElement, marker: MapMarker) {
        node.style.left = `${marker.x}px`
        node.style.top = `${marker.y}px`
        node.style.setProperty('--marker-color', marker.color)
        node.dataset.type = marker.type
        const title = node.querySelector('.marker__title')
        if (title) title.textContent = marker.title
        const visible = !this.#hidden && (marker.minScale <= 0 || this.#map.view.scale >= marker.minScale)
        node.classList.toggle('is-hidden', !visible)
    }

    #applyVisibility(scale: number) {
        for (const marker of this.#items) {
            const node = this.#nodes.get(marker.id)
            if (!node) continue
            const visible = marker.minScale <= 0 || scale >= marker.minScale
            node.classList.toggle('is-hidden', !visible)
        }
    }

    #onMapPointerDown = (e: PointerEvent) => {
        this.#downAt = { x: e.clientX, y: e.clientY }
    }

    #onMapClick = (e: MouseEvent) => {
        const down = this.#downAt
        this.#downAt = null
        // 拖动平移之后的那次 click 不算点击
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return

        if (!this.#editable) {
            this.onDeselect?.()
            return
        }
        const rect = this.#map.element.getBoundingClientRect()
        const view = this.#map.view
        const x = (e.clientX - rect.left - view.x) / view.scale
        const y = (e.clientY - rect.top - view.y) / view.scale
        this.onCreate?.(roundCoord(x), roundCoord(y))
    }

    #onMarkerPointerDown = (e: PointerEvent, marker: MapMarker, node: HTMLDivElement) => {
        // 别让地图跟着一起拖
        e.stopPropagation()
        if (!this.#editable) return

        e.preventDefault()
        this.onActivate?.(marker)

        const startX = e.clientX
        const startY = e.clientY
        const originX = marker.x
        const originY = marker.y
        let moved = false

        const handleMove = (event: PointerEvent) => {
            const dx = event.clientX - startX
            const dy = event.clientY - startY
            if (!moved && Math.hypot(dx, dy) < 3) return
            moved = true
            const scale = this.#map.view.scale
            marker.x = roundCoord(originX + dx / scale)
            marker.y = roundCoord(originY + dy / scale)
            node.style.left = `${marker.x}px`
            node.style.top = `${marker.y}px`
        }

        const handleUp = () => {
            window.removeEventListener('pointermove', handleMove)
            window.removeEventListener('pointerup', handleUp)
            if (moved) {
                this.#dragged = true
                this.onMove?.(marker)
            }
        }

        window.addEventListener('pointermove', handleMove)
        window.addEventListener('pointerup', handleUp, { once: true })
    }
}
