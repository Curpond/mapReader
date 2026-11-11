/**
 * 标签数据层：内存中的数据结构 + 从 data/markers.json 读取 + 写回服务器。
 *
 * 坐标约定：x / y 是「图片原始像素坐标」（左上角为原点），
 * 与缩放、窗口大小无关，所以标签永远钉在同一个地物上。
 */

export type MarkerType = 'star' | 'label'

export interface MapMarker {
    id: string
    /** 图片原始像素坐标 */
    x: number
    y: number
    /** star = 五角星 + 文字；label = 纯文字 */
    type: MarkerType
    title: string
    color: string
    /** 0 = 始终显示；否则当缩放倍数 >= minScale 才显示 */
    minScale: number
    /** 信息面板内容（Markdown） */
    markdown: string
    /** 子地图：相对 maps/ 的路径，例如 sub/山洞.png；空字符串表示没有 */
    submap: string
}

export interface MarkersFile {
    version: number
    /** 键是 maps/ 下的文件名 */
    maps: Record<string, MapMarker[]>
}

export type SaveState =
    | { state: 'idle' }
    | { state: 'saving' }
    | { state: 'saved'; at: Date }
    | { state: 'error'; message: string }

/** 编译后在 dist/ 里，所以 ../ 就是项目根目录 */
const DATA_URL = new URL('../data/markers.json', import.meta.url)
const SAVE_URL = new URL('../api/markers', import.meta.url)

export const DEFAULT_MARKER_COLOR = '#ffd166'

const clampCoord = (value: unknown, fallback = 0) => {
    const num = Number(value)
    return Number.isFinite(num) ? Math.round(num * 10) / 10 : fallback
}

export const createMarkerId = (): string =>
    `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

export const createMarker = (x: number, y: number, patch: Partial<MapMarker> = {}): MapMarker => ({
    id: createMarkerId(),
    x: clampCoord(x),
    y: clampCoord(y),
    type: 'star',
    title: '新标记',
    color: DEFAULT_MARKER_COLOR,
    minScale: 0,
    markdown: '',
    submap: '',
    ...patch,
})

/** 规范化子地图路径：统一正斜杠、去掉前导斜杠、禁止跳出 maps/ */
export const normalizeSubmap = (value: unknown): string => {
    const raw = String(value ?? '').replace(/\\/g, '/').replace(/^\/+/, '').trim()
    if (!raw) return ''
    if (raw.split('/').some((segment) => segment === '..')) return ''
    return raw
}

/** 兼容手工改坏的字段：读进来一律走一遍规范化 */
const normalizeMarker = (raw: Partial<MapMarker> | null | undefined, index: number): MapMarker => ({
    id: typeof raw?.id === 'string' && raw.id ? raw.id : `m_imported_${index}`,
    x: clampCoord(raw?.x),
    y: clampCoord(raw?.y),
    type: raw?.type === 'label' ? 'label' : 'star',
    title: typeof raw?.title === 'string' ? raw.title : '未命名',
    color: typeof raw?.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(raw.color) ? raw.color : DEFAULT_MARKER_COLOR,
    minScale: Math.max(0, Number(raw?.minScale) || 0),
    markdown: typeof raw?.markdown === 'string' ? raw.markdown : '',
    submap: normalizeSubmap(raw?.submap),
})

export class MarkerStore {
    #data: MarkersFile = { version: 1, maps: {} }
    #saveTimer: ReturnType<typeof setTimeout> | null = null
    #saving = false

    onStatus?: (state: SaveState) => void

    get all() {
        return this.#data
    }

    list(file: string): MapMarker[] {
        const found = this.#data.maps[file]
        if (!found) return []
        // 返回浅拷贝，避免调用方无意中改到原始数组
        return found.map((marker) => ({ ...marker }))
    }

    /** 直接用新的数组替换某张地图的标签；顺手合并同 id 的深拷贝 */
    set(file: string, markers: MapMarker[]) {
        this.#data.maps[file] = markers.map((marker) => ({ ...marker }))
    }

    removeMap(file: string) {
        delete this.#data.maps[file]
    }

    async load(): Promise<void> {
        try {
            const response = await fetch(DATA_URL, { cache: 'no-cache' })
            if (!response.ok) {
                if (response.status === 404) return // 还没有数据文件，当作空
                throw new Error(`HTTP ${response.status}`)
            }
            const raw = (await response.json()) as Partial<MarkersFile>
            const maps: Record<string, MapMarker[]> = {}
            if (raw && typeof raw.maps === 'object' && raw.maps) {
                for (const [file, markers] of Object.entries(raw.maps)) {
                    if (!Array.isArray(markers)) continue
                    maps[file] = markers.map((marker, index) => normalizeMarker(marker, index))
                }
            }
            this.#data = { version: 1, maps }
        } catch (err) {
            // 读不到就当空数据，不阻塞地图本身
            console.warn('标签数据读取失败：', err)
            this.#data = { version: 1, maps: {} }
        }
    }

    /** 改动后调用：合并短时间内的多次保存 */
    scheduleSave(delay = 400) {
        if (this.#saveTimer !== null) clearTimeout(this.#saveTimer)
        this.#saveTimer = setTimeout(() => {
            this.#saveTimer = null
            void this.save()
        }, delay)
    }

    async save(): Promise<boolean> {
        if (this.#saving) {
            // 正在保存时又改动，稍后再存一次
            this.scheduleSave(600)
            return false
        }
        this.#saving = true
        this.onStatus?.({ state: 'saving' })
        try {
            const response = await fetch(SAVE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.#data),
            })
            const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null
            if (!response.ok || !payload?.ok) {
                throw new Error(payload?.error ?? `HTTP ${response.status}`)
            }
            this.onStatus?.({ state: 'saved', at: new Date() })
            return true
        } catch (err) {
            this.onStatus?.({
                state: 'error',
                message: err instanceof Error ? err.message : String(err),
            })
            return false
        } finally {
            this.#saving = false
        }
    }

    /** 浏览器里下载一份 JSON 备份（静态托管、或写盘接口不可用时用） */
    downloadBackup() {
        const blob = new Blob([`${JSON.stringify(this.#data, null, 2)}\n`], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = 'markers.json'
        anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
}
