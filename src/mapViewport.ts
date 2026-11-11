/**
 * 一个「地图视图」= MapReader + 标签层 + 导航栈。
 *
 * 导航栈让它支持「进入子地图」和「返回上一层」：
 * 每个节点记住自己的缩放/位置，返回时原样还原，所以来回钻不会迷路。
 * 主视图和浮窗预览共用这一个类，只是浮窗不开编辑。
 */
import { MapReader, type MapReaderOptions } from './mapReader.js'
import { MarkerLayer } from './markerLayer.js'
import type { MapMarker } from './markerStore.js'

export interface MapNode {
    /** 标签数据里的键：主地图是文件名，子地图是相对 maps/ 的路径（如 sub/山洞.png） */
    key: string
    /** 显示名 */
    name: string
}

/** 由 key 推导显示名：取文件名去掉扩展名 */
export const nameOfKey = (key: string): string => {
    const base = key.split('/').pop() ?? key
    return base.replace(/\.[^.]+$/, '')
}

interface ViewState {
    x: number
    y: number
    scale: number
}

export interface MapViewportOptions {
    container: HTMLElement
    /** 由 key 生成图片地址 */
    urlOf: (key: string) => string
    /** 取某张地图上的标签 */
    getMarkers: (key: string) => MapMarker[]
    /** 是否允许编辑（点击新建、拖动标签） */
    editable?: boolean
    readerOptions?: MapReaderOptions | undefined
    onStackChange?: ((stack: readonly MapNode[]) => void) | undefined
    onHover?: ((marker: MapMarker | null, clientX: number, clientY: number) => void) | undefined
    onActivate?: ((marker: MapMarker) => void) | undefined
    onDeselect?: (() => void) | undefined
    onCreate?: ((x: number, y: number) => void) | undefined
    onMove?: ((marker: MapMarker) => void) | undefined
    onContextMenu?: ((marker: MapMarker | null, clientX: number, clientY: number) => void) | undefined
    onLoadError?: ((key: string, source: string) => void) | undefined
}

export class MapViewport {
    readonly map: MapReader
    readonly layer: MarkerLayer

    #options: MapViewportOptions
    #stack: MapNode[] = []
    #views = new Map<string, ViewState>()
    #pending: { key: string; restore: ViewState | null } | null = null

    constructor(options: MapViewportOptions) {
        this.#options = options
        this.map = new MapReader('', options.readerOptions)
        this.layer = new MarkerLayer(this.map)
        options.container.appendChild(this.map.element)

        this.layer.onHover = (marker, x, y) => options.onHover?.(marker, x, y)
        this.layer.onActivate = (marker) => options.onActivate?.(marker)
        this.layer.onDeselect = () => options.onDeselect?.()
        this.layer.onCreate = (x, y) => options.onCreate?.(x, y)
        this.layer.onMove = (marker) => options.onMove?.(marker)
        this.layer.onContextMenu = (marker, x, y) => options.onContextMenu?.(marker, x, y)

        this.layer.setEditable(options.editable ?? false)

        this.map.element.addEventListener('mapready', this.#onReady)
        this.map.element.addEventListener('maperror', this.#onError)
    }

    get stack(): readonly MapNode[] {
        return this.#stack
    }

    get current(): MapNode | null {
        return this.#stack[this.#stack.length - 1] ?? null
    }

    get depth(): number {
        return this.#stack.length
    }

    /** 打开一张地图，重置导航栈 */
    open(node: MapNode) {
        this.#rememberCurrentView()
        this.#stack = [node]
        this.#navigate(node)
    }

    /** 进入下一层（子地图） */
    enter(node: MapNode) {
        // 关键：离开当前层之前先把它现在的缩放/位置记下来，返回时要原样还原
        this.#rememberCurrentView()
        this.#stack = [...this.#stack, node]
        this.#navigate(node)
    }

    /** 返回到上一层；已经在最外层则返回 false */
    back(): boolean {
        if (this.#stack.length <= 1) return false
        this.#rememberCurrentView()
        this.#stack = this.#stack.slice(0, -1)
        const parent = this.#stack[this.#stack.length - 1]
        if (!parent) return false
        this.#navigate(parent)
        return true
    }

    /** 直接截断到某一层（面包屑点击） */
    goTo(depth: number) {
        const target = Math.max(1, Math.min(depth, this.#stack.length))
        if (target === this.#stack.length) return
        this.#rememberCurrentView()
        this.#stack = this.#stack.slice(0, target)
        const node = this.#stack[target - 1]
        if (node) this.#navigate(node)
    }

    /** 标签数据变化后重新渲染 */
    refreshMarkers() {
        const current = this.current
        if (!current) return
        this.layer.setMarkers(this.#options.getMarkers(current.key))
    }

    setEditable(editable: boolean) {
        this.layer.setEditable(editable)
    }

    setHidden(hidden: boolean) {
        this.layer.setHidden(hidden)
    }

    destroy() {
        this.map.element.removeEventListener('mapready', this.#onReady)
        this.map.element.removeEventListener('maperror', this.#onError)
        this.layer.destroy()
        this.map.destroy()
        this.#views.clear()
        this.#stack = []
    }

    // ------------------------------------------------------------ 内部

    #rememberCurrentView() {
        const current = this.current
        if (!current || !this.map.isReady) return
        this.#views.set(current.key, this.map.view)
    }

    #navigate(node: MapNode) {
        // 换图先把旧标签清掉，避免旧标签短暂浮在新图上面
        this.layer.setMarkers([])
        this.#pending = { key: node.key, restore: this.#views.get(node.key) ?? null }
        this.map.load(this.#options.urlOf(node.key))
        this.#options.onStackChange?.(this.#stack)
    }

    #onReady = () => {
        const pending = this.#pending
        const current = this.current
        if (!pending || !current) return
        this.#pending = null

        const restore = pending.restore
        if (restore) this.map.setView(restore)
        else this.map.fit()

        this.layer.setMarkers(this.#options.getMarkers(pending.key))
        this.layer.sync()
        this.#options.onStackChange?.(this.#stack)
    }

    #onError = () => {
        const pending = this.#pending
        const key = pending?.key ?? this.current?.key ?? ''
        this.#pending = null
        this.#options.onLoadError?.(key, this.map.source)
    }
}
