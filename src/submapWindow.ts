/**
 * 浮窗预览（方案 B）：在大地图上开一个小窗显示子地图。
 *
 * 用途是「瞄一眼」——保留大地图的全局位置。窗里同样是完整的 MapReader，
 * 所以小窗也能滚轮缩放/拖动，但不开编辑；想好好看就点「在主视图打开」。
 */
import type { MapMarker } from './markerStore.js'
import { MapViewport, nameOfKey, type MapNode } from './mapViewport.js'

export interface SubmapWindowOptions {
    urlOf: (key: string) => string
    getMarkers: (key: string) => MapMarker[]
    onOpenInMain: (node: MapNode) => void
    onHover?: ((marker: MapMarker | null, clientX: number, clientY: number) => void) | undefined
    onContextMenu?: ((marker: MapMarker | null, clientX: number, clientY: number) => void) | undefined
}

export class SubmapWindow {
    readonly element: HTMLElement

    #options: SubmapWindowOptions
    #viewport: MapViewport | null = null
    #body: HTMLDivElement
    #title: HTMLSpanElement
    #trail: HTMLSpanElement
    #open = false

    constructor(options: SubmapWindowOptions) {
        this.#options = options

        this.element = document.createElement('section')
        this.element.className = 'submap-window'
        this.element.hidden = true
        this.element.innerHTML = `
            <header class="submap-window__head">
                <span class="submap-window__badge">子地图</span>
                <span class="submap-window__title" data-role="title"></span>
                <span class="submap-window__trail" data-role="trail"></span>
                <button type="button" class="submap-window__btn" data-action="main" title="在主视图中打开">⤢</button>
                <button type="button" class="submap-window__btn" data-action="close" title="关闭（Esc）">×</button>
            </header>
            <div class="submap-window__body" data-role="body"></div>
            <footer class="submap-window__foot">
                <span class="submap-window__hint">滚轮缩放 · 拖动平移 · 双击放大</span>
                <button type="button" class="submap-window__link" data-action="back" hidden>← 返回上一层</button>
            </footer>
        `

        this.#body = this.element.querySelector('[data-role="body"]')!
        this.#title = this.element.querySelector('[data-role="title"]')!
        this.#trail = this.element.querySelector('[data-role="trail"]')!

        this.element.querySelector('[data-action="close"]')!.addEventListener('click', () => this.close())
        this.element.querySelector('[data-action="main"]')!.addEventListener('click', () => {
            const current = this.#viewport?.current
            if (current) {
                this.close()
                this.#options.onOpenInMain(current)
            }
        })
        this.element.querySelector('[data-action="back"]')!.addEventListener('click', () => {
            this.#viewport?.back()
        })

        this.#bindDrag()
    }

    get isOpen() {
        return this.#open
    }

    /** 打开（或在小窗内继续下钻） */
    open(node: MapNode) {
        this.element.hidden = false

        if (!this.#viewport) {
            this.#viewport = new MapViewport({
                container: this.#body,
                urlOf: this.#options.urlOf,
                getMarkers: this.#options.getMarkers,
                editable: false,
                onStackChange: () => this.#renderHead(),
                onHover: this.#options.onHover,
                onContextMenu: this.#options.onContextMenu,
                onActivate: (marker) => {
                    // 小窗里点带子地图的标签，就在小窗里继续下钻
                    if (marker.submap) {
                        this.#viewport?.enter({ key: marker.submap, name: nameOfKey(marker.submap) })
                    }
                },
                onLoadError: () => this.#title.textContent = '子地图加载失败',
            })
            this.#viewport.open(node)
        } else if (this.#viewport.current?.key !== node.key) {
            this.#viewport.open(node)
        }

        this.#open = true
        this.#renderHead()
        this.#clampIntoView()
    }

    close() {
        this.#open = false
        this.element.hidden = true
    }

    destroy() {
        this.#viewport?.destroy()
        this.#viewport = null
        this.element.remove()
    }

    // ------------------------------------------------------------ 内部

    #renderHead() {
        const stack = this.#viewport?.stack ?? []
        const current = stack[stack.length - 1]
        this.#title.textContent = current?.name ?? '子地图'
        this.#trail.textContent = stack.length > 1
            ? stack.map((node) => node.name).join(' › ')
            : ''
        const backButton = this.element.querySelector<HTMLButtonElement>('[data-action="back"]')
        if (backButton) backButton.hidden = stack.length <= 1
    }

    #clampIntoView() {
        const rect = this.element.getBoundingClientRect()
        if (rect.right > window.innerWidth || rect.bottom > window.innerHeight || rect.left < 0 || rect.top < 0) {
            this.#place(window.innerWidth - rect.width - 24, window.innerHeight - rect.height - 76)
        }
    }

    #place(left: number, top: number) {
        this.element.style.left = `${Math.max(8, left)}px`
        this.element.style.top = `${Math.max(8, top)}px`
        this.element.style.right = 'auto'
        this.element.style.bottom = 'auto'
    }

    #bindDrag() {
        const head = this.element.querySelector<HTMLElement>('.submap-window__head')
        if (!head) return
        head.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return
            if ((e.target as HTMLElement).closest('button')) return
            e.preventDefault()
            const rect = this.element.getBoundingClientRect()
            const offsetX = e.clientX - rect.left
            const offsetY = e.clientY - rect.top

            const move = (event: PointerEvent) => {
                this.#place(
                    Math.min(Math.max(0, event.clientX - offsetX), window.innerWidth - 120),
                    Math.min(Math.max(0, event.clientY - offsetY), window.innerHeight - 80),
                )
            }
            const up = () => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
            }
            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', up, { once: true })
        })
    }
}
