export interface MapReaderOptions {
    /** 最小缩放倍数（1 = 图片原始像素 1:1） */
    minScale?: number
    /** 最大缩放倍数 */
    maxScale?: number
    /** 鼠标滚轮缩放灵敏度 */
    wheelSpeed?: number
    /** 触摸板 / Ctrl+滚轮（捏合）缩放灵敏度 */
    pinchSpeed?: number
    /** 图片加载完成后自动等比缩放到容器内 */
    fitOnLoad?: boolean
    /** 限制图片不被拖出容器（小于容器时自动居中） */
    constrain?: boolean
    /** fitOnLoad 为 false 时的初始缩放倍数 */
    initialScale?: number
}

type ResolvedOptions = { [K in keyof MapReaderOptions]-?: NonNullable<MapReaderOptions[K]> }

const DEFAULTS: ResolvedOptions = {
    minScale: 0.02,
    maxScale: 8,
    wheelSpeed: 0.0016,
    pinchSpeed: 0.01,
    fitOnLoad: true,
    constrain: true,
    initialScale: 1,
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * 一个支持「以鼠标位置为基准缩放」和「自由拖动」的模拟地图查看器。
 *
 * 核心思路：把图片的位移和缩放统一放在两个数值字段里维护
 * （#x/#y 为图片左上角在容器内的 CSS 像素坐标，#scale 为缩放倍数），
 * 每次变化只把这两个值合成一个 transform 字符串写进 style，
 * 绝不从 style 字符串里反解析数值。
 *
 * 派发的事件（都冒泡）：
 * - `mapload`   开始加载/切换地图，detail 为 { source }
 * - `mapready`  图片加载完成、首帧视图已就绪
 * - `mapchange` 视图发生变化，detail 为 { x, y, scale }
 * - `maperror`  图片加载失败，detail 为 { source }
 */
export class MapReader {
    readonly element: HTMLDivElement
    readonly #image: HTMLImageElement
    readonly #options: ResolvedOptions

    /** 图片左上角在容器内的位置（未缩放前的 CSS 像素） */
    #x = 0
    #y = 0
    #scale = 1

    #naturalWidth = 0
    #naturalHeight = 0
    #loaded = false
    #source = ''

    #pointerId: number | null = null
    #dragging = false
    #lastClientX = 0
    #lastClientY = 0

    #resizeObserver: ResizeObserver | null = null

    constructor(source: string, options: MapReaderOptions = {}) {
        this.#options = {
            minScale: options.minScale ?? DEFAULTS.minScale,
            maxScale: options.maxScale ?? DEFAULTS.maxScale,
            wheelSpeed: options.wheelSpeed ?? DEFAULTS.wheelSpeed,
            pinchSpeed: options.pinchSpeed ?? DEFAULTS.pinchSpeed,
            fitOnLoad: options.fitOnLoad ?? DEFAULTS.fitOnLoad,
            constrain: options.constrain ?? DEFAULTS.constrain,
            initialScale: options.initialScale ?? DEFAULTS.initialScale,
        }

        this.element = document.createElement('div')
        this.element.className = 'map-reader'
        // 关键样式内联写死：组件不依赖外部 CSS 也能正确工作
        this.element.style.cssText = [
            'position: relative',
            'display: block',
            'width: 100%',
            'height: 100%',
            'overflow: hidden',
            'touch-action: none',
            'user-select: none',
            '-webkit-user-select: none',
            'cursor: grab',
        ].join(';')

        this.#image = document.createElement('img')
        this.#image.className = 'map-reader__image'
        this.#image.draggable = false
        this.#image.decoding = 'async'
        this.#image.alt = ''
        this.#image.style.cssText = [
            'position: absolute',
            'top: 0',
            'left: 0',
            // 缩放的基准点，必须是左上角，否则位移/缩放换算不成立
            'transform-origin: 0 0',
            'will-change: transform',
            // 指针事件统一交给容器处理
            'pointer-events: none',
            '-webkit-user-drag: none',
        ].join(';')
        this.element.appendChild(this.#image)

        this.#image.addEventListener('load', this.#onImageLoad)
        this.#image.addEventListener('error', this.#onImageError)
        this.#bindEvents()
        this.#apply()
        this.#observeResize()

        this.load(source)
    }

    // ---------------------------------------------------------------- 对外 API

    /** 当前地图地址 */
    get source() {
        return this.#source
    }

    /** 切换地图（同一个实例复用，会自动重新 fit） */
    load(source: string) {
        if (!source || source === this.#source) return

        this.#source = source
        this.#loaded = false
        this.#naturalWidth = 0
        this.#naturalHeight = 0
        this.#scale = 1
        this.#x = 0
        this.#y = 0
        this.element.dataset.ready = 'false'
        delete this.element.dataset.error
        // 清掉上一张图的布局尺寸，避免加载期间按旧尺寸参与计算
        this.#image.style.width = ''
        this.#image.style.height = ''
        this.#apply()

        this.element.dispatchEvent(new CustomEvent('mapload', {
            bubbles: true,
            detail: { source },
        }))

        this.#image.src = source
        // 命中缓存时 load 事件可能已经错过，这里补一次
        if (this.#image.complete && this.#image.naturalWidth > 0) {
            queueMicrotask(this.#onImageLoad)
        }
    }

    /** 当前缩放倍数 */
    get scale() {
        return this.#scale
    }

    /** 图片左上角相对容器的位置 */
    get position() {
        return { x: this.#x, y: this.#y }
    }

    /** 图片原始像素尺寸（加载完成前为 0） */
    get naturalSize() {
        return { width: this.#naturalWidth, height: this.#naturalHeight }
    }

    get isReady() {
        return this.#loaded
    }

    /** 以某个视口坐标（clientX/clientY）为基准点缩放，factor > 1 放大，< 1 缩小 */
    zoomAt(clientX: number, clientY: number, factor: number) {
        const rect = this.element.getBoundingClientRect()
        this.#zoomAtLocal(clientX - rect.left, clientY - rect.top, factor)
    }

    /** 以容器中心为基准点缩放 */
    zoomBy(factor: number) {
        this.#zoomAtLocal(this.element.clientWidth / 2, this.element.clientHeight / 2, factor)
    }

    /** 缩放到指定倍数（以容器中心为基准点） */
    setScale(scale: number) {
        if (!this.#loaded) return
        this.#zoomAtLocal(
            this.element.clientWidth / 2,
            this.element.clientHeight / 2,
            this.#clampScale(scale) / this.#scale,
        )
    }

    /** 平移指定像素（正数向右/向下） */
    panBy(dx: number, dy: number) {
        this.#x += dx
        this.#y += dy
        this.#constrain()
        this.#apply()
    }

    /** 等比缩放到刚好完整显示整张地图并居中 */
    fit() {
        if (!this.#loaded) return
        const cw = this.element.clientWidth || 1
        const ch = this.element.clientHeight || 1
        const scale = this.#clampScale(Math.min(cw / this.#naturalWidth, ch / this.#naturalHeight))
        this.#scale = scale
        this.#x = (cw - this.#naturalWidth * scale) / 2
        this.#y = (ch - this.#naturalHeight * scale) / 2
        this.#apply()
    }

    /** 回到初始视图 */
    reset() {
        if (this.#options.fitOnLoad) {
            this.fit()
            return
        }
        if (!this.#loaded) return
        this.#scale = this.#clampScale(this.#options.initialScale)
        this.#constrain()
        this.#apply()
    }

    destroy() {
        this.#resizeObserver?.disconnect()
        this.#resizeObserver = null
        this.element.removeEventListener('wheel', this.#onWheel)
        this.element.removeEventListener('pointerdown', this.#onPointerDown)
        this.element.removeEventListener('pointermove', this.#onPointerMove)
        this.element.removeEventListener('pointerup', this.#onPointerUp)
        this.element.removeEventListener('pointercancel', this.#onPointerUp)
        this.element.removeEventListener('lostpointercapture', this.#onPointerUp)
        this.element.removeEventListener('dragstart', this.#onDragStart)
        this.element.removeEventListener('dblclick', this.#onDblClick)
        this.#image.removeEventListener('load', this.#onImageLoad)
        this.#image.removeEventListener('error', this.#onImageError)
        this.element.remove()
    }

    // ------------------------------------------------------------ 内部实现

    #bindEvents() {
        // passive: false 才能 preventDefault，拦掉浏览器默认的“页面缩放/滚动”
        this.element.addEventListener('wheel', this.#onWheel, { passive: false })
        this.element.addEventListener('pointerdown', this.#onPointerDown)
        this.element.addEventListener('pointermove', this.#onPointerMove)
        this.element.addEventListener('pointerup', this.#onPointerUp)
        this.element.addEventListener('pointercancel', this.#onPointerUp)
        this.element.addEventListener('lostpointercapture', this.#onPointerUp)
        this.element.addEventListener('dragstart', this.#onDragStart)
        this.element.addEventListener('dblclick', this.#onDblClick)
    }

    #observeResize() {
        if (typeof ResizeObserver === 'undefined') return
        this.#resizeObserver = new ResizeObserver(() => {
            this.#constrain()
            this.#apply()
        })
        this.#resizeObserver.observe(this.element)
    }

    #onImageLoad = () => {
        this.#naturalWidth = this.#image.naturalWidth
        this.#naturalHeight = this.#image.naturalHeight
        if (!this.#naturalWidth || !this.#naturalHeight) return

        // 按原始像素设定布局尺寸：CSS 像素与设备像素比无关，
        // 不要再用 devicePixelRatio 去除，否则高分屏上图片会“莫名变小”。
        this.#image.style.width = `${this.#naturalWidth}px`
        this.#image.style.height = `${this.#naturalHeight}px`

        this.#loaded = true
        this.element.dataset.ready = 'true'

        if (this.#options.fitOnLoad) {
            this.fit()
        } else {
            this.#scale = this.#clampScale(this.#options.initialScale)
            this.#constrain()
            this.#apply()
        }
        this.element.dispatchEvent(new CustomEvent('mapready', { bubbles: true }))
    }

    #onImageError = () => {
        this.#loaded = false
        this.element.dataset.error = 'true'
        this.element.dispatchEvent(new CustomEvent('maperror', {
            bubbles: true,
            detail: { source: this.#image.currentSrc || this.#image.src },
        }))
    }

    #clampScale(scale: number) {
        return clamp(scale, this.#options.minScale, this.#options.maxScale)
    }

    /** 以容器内坐标 (px, py) 为基准点缩放：让该点下方的图片内容保持不动 */
    #zoomAtLocal(px: number, py: number, factor: number) {
        if (!this.#loaded || !Number.isFinite(factor) || factor <= 0) return

        const nextScale = this.#clampScale(this.#scale * factor)
        if (nextScale === this.#scale) return

        const ratio = nextScale / this.#scale
        // 光标下的图片坐标：(px - x) / scale，缩放后要仍然落在 px 上
        this.#x = px - (px - this.#x) * ratio
        this.#y = py - (py - this.#y) * ratio
        this.#scale = nextScale

        this.#constrain()
        this.#apply()
    }

    /** 保证图片不会跑出可视区域；图片比容器小时居中 */
    #constrain() {
        if (!this.#options.constrain || !this.#loaded) return

        const cw = this.element.clientWidth
        const ch = this.element.clientHeight
        const iw = this.#naturalWidth * this.#scale
        const ih = this.#naturalHeight * this.#scale

        this.#x = iw <= cw ? (cw - iw) / 2 : clamp(this.#x, cw - iw, 0)
        this.#y = ih <= ch ? (ch - ih) / 2 : clamp(this.#y, ch - ih, 0)
    }

    #apply() {
        // 位移与缩放合成一条 transform；origin 为 0 0（见构造函数内联样式），
        // 所以图片像素坐标 (u,v) 映射到容器坐标为 (u*scale + x, v*scale + y)
        this.#image.style.transform = `translate3d(${this.#x}px, ${this.#y}px, 0) scale(${this.#scale})`
        this.element.dataset.scale = this.#scale.toFixed(4)
        // 供外部 UI 同步视图状态（缩放倍数等）
        this.element.dispatchEvent(new CustomEvent('mapchange', { detail: this.view }))
    }

    /** 当前视图状态快照 */
    get view() {
        return { x: this.#x, y: this.#y, scale: this.#scale }
    }

    /** 整图刚好铺满可视区域时的缩放倍数（「全图视角」的基准值） */
    get fitScale() {
        if (!this.#loaded) return 1
        const cw = this.element.clientWidth || 1
        const ch = this.element.clientHeight || 1
        return Math.min(cw / this.#naturalWidth, ch / this.#naturalHeight)
    }

    /** 把图片上的某个像素点移到视口中心 */
    centerOn(imageX: number, imageY: number) {
        if (!this.#loaded) return
        this.#x = this.element.clientWidth / 2 - imageX * this.#scale
        this.#y = this.element.clientHeight / 2 - imageY * this.#scale
        this.#constrain()
        this.#apply()
    }

    // ------------------------------------------------------------ 事件回调

    #onWheel = (e: WheelEvent) => {
        e.preventDefault()
        if (!this.#loaded) return

        // 统一三种 deltaMode 到像素
        let delta = e.deltaY
        if (e.deltaMode === 1) delta *= 16
        else if (e.deltaMode === 2) delta *= this.element.clientHeight

        // 触摸板捏合在浏览器里表现为带 ctrlKey 的 wheel，步长要放大一些
        const speed = e.ctrlKey ? this.#options.pinchSpeed : this.#options.wheelSpeed
        // 指数缩放：每一档滚轮的缩放比例恒定，手感均匀
        this.zoomAt(e.clientX, e.clientY, Math.exp(-delta * speed))
    }

    #onPointerDown = (e: PointerEvent) => {
        if (!this.#loaded) return
        if (e.button !== 0 && e.button !== 1) return // 左键 / 中键拖动
        if (this.#pointerId !== null) return // 已经有一根手指/一个键在拖

        this.#dragging = true
        this.#pointerId = e.pointerId
        this.#lastClientX = e.clientX
        this.#lastClientY = e.clientY
        // 指针捕获：鼠标移出容器甚至移出窗口，拖动都不会中断
        try {
            this.element.setPointerCapture(e.pointerId)
        } catch {
            // 指针已失效（或为合成事件）时忽略，不影响拖动逻辑
        }
        this.element.classList.add('is-dragging')
        this.element.style.cursor = 'grabbing'
        e.preventDefault()
    }

    #onPointerMove = (e: PointerEvent) => {
        if (!this.#dragging || e.pointerId !== this.#pointerId) return

        // 用两次 clientX/Y 的差值，而不是 movementX/Y：
        // movementX 在部分浏览器/缩放环境下会失真，且受指针捕获影响
        const dx = e.clientX - this.#lastClientX
        const dy = e.clientY - this.#lastClientY
        this.#lastClientX = e.clientX
        this.#lastClientY = e.clientY
        if (dx === 0 && dy === 0) return

        this.#x += dx
        this.#y += dy
        this.#constrain()
        this.#apply()
        e.preventDefault()
    }

    #onPointerUp = (e: PointerEvent) => {
        if (e.pointerId !== this.#pointerId) return
        this.#dragging = false
        this.#pointerId = null
        this.element.classList.remove('is-dragging')
        this.element.style.cursor = 'grab'
        if (this.element.hasPointerCapture(e.pointerId)) {
            this.element.releasePointerCapture(e.pointerId)
        }
    }

    #onDragStart = (e: DragEvent) => {
        e.preventDefault()
    }

    #onDblClick = (e: MouseEvent) => {
        // 双击原地放大，Shift+双击缩小
        this.zoomAt(e.clientX, e.clientY, e.shiftKey ? 0.5 : 2)
    }
}
