/**
 * 标签相关的 UI：悬停预览气泡、固定的信息卡、编辑表单、当前地图的标签列表。
 * 只负责显示和收集输入，数据由 main.ts 统一管理。
 */
import { markdownToPlain, renderMarkdown } from './markdown.js'
import { nameOfKey, type MapNode } from './mapViewport.js'
import type { MapMarker, SaveState } from './markerStore.js'

export interface MarkerPanelHandlers {
    onPatch: (patch: Partial<MapMarker>) => void
    onDelete: () => void
    onLocate: () => void
    onClose: () => void
    onSelect: (id: string) => void
    onExport: () => void
    /** 进入子地图（主视图下钻） */
    onEnter: () => void
    /** 在浮窗中预览子地图 */
    onPreview: () => void
}

export interface EditorContext {
    /** 当前「整图可见」的缩放倍数，用来换算「放大 2×/4×」预设 */
    fitScale: number
    markers: MapMarker[]
    selectedId: string | null
    /** 可供选择的子地图 */
    submaps: MapNode[]
}

const COLOR_PRESETS = ['#ffd166', '#ff6b6b', '#4ecdc4', '#a78bfa', '#f78fb3', '#ffffff']

const PRESET_RATIO = { '2': 2, '4': 4 } as const

const formatTime = (date: Date) =>
    `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`

export class MarkerPanel {
    readonly element: HTMLElement
    readonly tooltip: HTMLDivElement

    #handlers: MarkerPanelHandlers
    #title: HTMLElement
    #badge: HTMLElement
    #view: HTMLElement
    #form: HTMLElement
    #info: HTMLElement
    #status: HTMLElement
    #list: HTMLElement
    #count: HTMLElement
    #actionsView: HTMLElement
    #actionsEdit: HTMLElement
    #enterButton: HTMLButtonElement
    #previewButton: HTMLButtonElement
    #titleInput: HTMLInputElement
    #colorInput: HTMLInputElement
    #minScaleInput: HTMLInputElement
    #markdownInput: HTMLTextAreaElement
    #submapSelect: HTMLSelectElement
    #typeButtons: HTMLButtonElement[]
    #presetButtons: HTMLButtonElement[]
    #swatches: HTMLElement
    #tipTitle: HTMLElement
    #tipBody: HTMLElement

    #mode: 'closed' | 'info' | 'edit' = 'closed'
    #marker: MapMarker | null = null
    #fitScale = 1

    constructor(handlers: MarkerPanelHandlers) {
        this.#handlers = handlers

        this.element = document.createElement('aside')
        this.element.className = 'marker-panel'
        this.element.hidden = true
        this.element.innerHTML = `
            <header class="marker-panel__head">
                <span class="marker-panel__badge" data-role="badge">标签</span>
                <h2 class="marker-panel__title" data-role="title"></h2>
                <button type="button" class="marker-panel__close" data-action="export" title="下载 markers.json 备份">⭳</button>
                <button type="button" class="marker-panel__close" data-action="close" title="关闭（Esc）">×</button>
            </header>
            <div class="marker-panel__view" data-role="view">
                <p class="marker-panel__submap" data-role="submap-hint" hidden></p>
                <div class="marker-panel__info md" data-role="info"></div>
            </div>
            <div class="marker-panel__form" data-role="form" hidden>
                <label class="field">
                    <span class="field__label">名称</span>
                    <input class="field__input" type="text" data-field="title" maxlength="40" placeholder="比如：洛阳">
                </label>
                <div class="field">
                    <span class="field__label">形态</span>
                    <div class="seg" data-role="types">
                        <button type="button" class="seg__btn" data-type="star">★ 五角星</button>
                        <button type="button" class="seg__btn" data-type="label">纯文字</button>
                    </div>
                </div>
                <div class="field">
                    <span class="field__label">颜色</span>
                    <div class="field__row">
                        <input class="field__color" type="color" data-field="color">
                        <div class="swatches" data-role="swatches"></div>
                    </div>
                </div>
                <div class="field">
                    <span class="field__label">显示时机</span>
                    <div class="seg" data-role="presets">
                        <button type="button" class="seg__btn" data-preset="always">始终显示</button>
                        <button type="button" class="seg__btn" data-preset="2">放大 2×</button>
                        <button type="button" class="seg__btn" data-preset="4">放大 4×</button>
                    </div>
                    <div class="field__row field__row--tight">
                        <span class="field__hint">自定义阈值</span>
                        <input class="field__input field__input--num" type="number" min="0" step="0.05" data-field="minScale">
                    </div>
                    <p class="field__hint">0 = 始终显示；数字越大，越晚出现。</p>
                </div>
                <div class="field">
                    <span class="field__label">子地图</span>
                    <select class="field__input" data-field="submap"></select>
                    <p class="field__hint">选一张子地图后，这个标签就能右键「进入此地图」。图片放在 maps/sub/ 下。</p>
                </div>
                <label class="field field--grow">
                    <span class="field__label">信息（Markdown）</span>
                    <textarea class="field__input field__textarea" rows="7" data-field="markdown"
                        placeholder="# 洛阳&#10;&#10;- 类型: 都城&#10;- 守将: 吕布&#10;&#10;| 属性 | 数值 |&#10;| --- | --- |&#10;| 人口 | 30 万 |"></textarea>
                </label>
                <div class="field">
                    <span class="field__label">当前地图的标签 <span data-role="count"></span></span>
                    <div class="marker-list" data-role="list"></div>
                </div>
            </div>
            <footer class="marker-panel__foot">
                <span class="marker-panel__status" data-role="status"></span>
                <div class="marker-panel__actions" data-role="actions-view">
                    <button type="button" class="btn" data-action="preview" hidden>浮窗</button>
                    <button type="button" class="btn btn--primary" data-action="enter" hidden>进入</button>
                </div>
                <div class="marker-panel__actions" data-role="actions-edit" hidden>
                    <button type="button" class="btn" data-action="locate">定位</button>
                    <button type="button" class="btn btn--danger" data-action="delete">删除</button>
                    <button type="button" class="btn btn--primary" data-action="done">完成</button>
                </div>
            </footer>
        `

        this.tooltip = document.createElement('div')
        this.tooltip.className = 'marker-tip'
        this.tooltip.hidden = true
        this.tooltip.innerHTML = '<div class="marker-tip__title"></div><div class="marker-tip__body"></div>'

        const pick = <T extends HTMLElement>(role: string) => this.element.querySelector<T>(`[data-role="${role}"]`)!
        this.#title = pick('title')
        this.#badge = pick('badge')
        this.#view = pick('view')
        this.#form = pick('form')
        this.#info = pick('info')
        this.#status = pick('status')
        this.#list = pick('list')
        this.#count = pick('count')
        this.#actionsView = pick('actions-view')
        this.#actionsEdit = pick('actions-edit')
        this.#submapHint = pick('submap-hint')
        this.#enterButton = this.element.querySelector<HTMLButtonElement>('[data-action="enter"]')!
        this.#previewButton = this.element.querySelector<HTMLButtonElement>('[data-action="preview"]')!
        this.#titleInput = this.element.querySelector<HTMLInputElement>('[data-field="title"]')!
        this.#colorInput = this.element.querySelector<HTMLInputElement>('[data-field="color"]')!
        this.#minScaleInput = this.element.querySelector<HTMLInputElement>('[data-field="minScale"]')!
        this.#markdownInput = this.element.querySelector<HTMLTextAreaElement>('[data-field="markdown"]')!
        this.#submapSelect = this.element.querySelector<HTMLSelectElement>('[data-field="submap"]')!
        this.#typeButtons = [...this.element.querySelectorAll<HTMLButtonElement>('[data-role="types"] [data-type]')]
        this.#presetButtons = [...this.element.querySelectorAll<HTMLButtonElement>('[data-role="presets"] [data-preset]')]
        this.#swatches = pick('swatches')
        this.#tipTitle = this.tooltip.querySelector('.marker-tip__title')!
        this.#tipBody = this.tooltip.querySelector('.marker-tip__body')!

        this.#bindEvents()
    }

    #submapHint: HTMLElement

    // ------------------------------------------------------------ 对外

    get mode() {
        return this.#mode
    }

    showTooltip(marker: MapMarker, clientX: number, clientY: number) {
        if (this.#mode === 'edit' && this.#marker?.id === marker.id) return
        const plain = markdownToPlain(marker.markdown)
        this.#tipTitle.textContent = marker.title || '未命名'
        const submapHint = marker.submap ? `⤵ 子地图：${nameOfKey(marker.submap)}　` : ''
        const body = plain ? (plain.length > 90 ? `${plain.slice(0, 90)}…` : plain) : '（没有填写信息）'
        this.#tipBody.textContent = `${submapHint}${body}`
        this.tooltip.hidden = false

        const { width, height } = this.tooltip.getBoundingClientRect()
        const gap = 14
        let left = clientX + gap
        let top = clientY - height - gap
        if (left + width > window.innerWidth - 8) left = clientX - width - gap
        if (top < 8) top = clientY + gap
        this.tooltip.style.left = `${Math.max(8, left)}px`
        this.tooltip.style.top = `${Math.max(8, top)}px`
    }

    hideTooltip() {
        this.tooltip.hidden = true
    }

    showInfo(marker: MapMarker) {
        this.#marker = marker
        this.#mode = 'info'
        this.element.hidden = false
        this.element.dataset.mode = 'info'
        this.#view.hidden = false
        this.#form.hidden = true
        this.#actionsView.hidden = false
        this.#actionsEdit.hidden = true
        this.#badge.textContent = marker.type === 'star' ? '★ 地标' : '纯文字'
        this.#title.textContent = marker.title || '未命名'
        this.#info.innerHTML = marker.markdown.trim()
            ? renderMarkdown(marker.markdown)
            : '<p class="md__empty">这个标签还没有填写信息。打开编辑模式后可以补充。</p>'

        const hasSubmap = Boolean(marker.submap)
        this.#submapHint.hidden = !hasSubmap
        if (hasSubmap) this.#submapHint.textContent = `⤵ 子地图：${nameOfKey(marker.submap)}`
        this.#enterButton.hidden = !hasSubmap
        this.#previewButton.hidden = !hasSubmap
        if (hasSubmap) this.#enterButton.textContent = `进入 ${nameOfKey(marker.submap)}`
        this.hideTooltip()
    }

    showEditor(marker: MapMarker, context: EditorContext) {
        this.#marker = marker
        this.#mode = 'edit'
        this.#fitScale = context.fitScale
        this.element.hidden = false
        this.element.dataset.mode = 'edit'
        this.#view.hidden = true
        this.#form.hidden = false
        this.#actionsView.hidden = true
        this.#actionsEdit.hidden = false
        this.#badge.textContent = '编辑标签'
        this.#title.textContent = marker.title || '新标记'

        this.#titleInput.value = marker.title
        this.#colorInput.value = this.#normalizeColor(marker.color)
        this.#minScaleInput.value = String(marker.minScale || 0)
        this.#markdownInput.value = marker.markdown
        this.#fillSubmapOptions(context.submaps, marker.submap)
        this.#syncTypeButtons(marker.type)
        this.#syncPresetButtons(marker.minScale)
        this.updateList(context.markers, context.selectedId)
        this.hideTooltip()
    }

    /** 编辑子地图选择框的选项 */
    #fillSubmapOptions(submaps: MapNode[], selected: string) {
        const options: Array<{ value: string; label: string }> = [
            { value: '', label: '（无）' },
            ...submaps.map((node) => ({ value: node.key, label: node.name })),
        ]
        // 选中的子地图不在清单里（比如文件被挪走）也要显示出来，避免静默丢失
        if (selected && !options.some((option) => option.value === selected)) {
            options.push({ value: selected, label: `${nameOfKey(selected)}（未在 maps/sub/ 中找到）` })
        }
        this.#submapSelect.textContent = ''
        for (const option of options) {
            const element = document.createElement('option')
            element.value = option.value
            element.textContent = option.label
            this.#submapSelect.appendChild(element)
        }
        this.#submapSelect.value = selected
    }

    updateList(markers: MapMarker[], selectedId: string | null) {
        this.#count.textContent = `（${markers.length}）`
        this.#list.textContent = ''
        if (markers.length === 0) {
            const empty = document.createElement('p')
            empty.className = 'field__hint'
            empty.textContent = '还没有标签。在地图上点一下就能添加。'
            this.#list.appendChild(empty)
            return
        }
        for (const marker of markers) {
            const item = document.createElement('button')
            item.type = 'button'
            item.className = 'marker-list__item'
            item.dataset.id = marker.id
            if (marker.id === selectedId) item.classList.add('is-active')
            const dot = document.createElement('span')
            dot.className = 'marker-list__dot'
            dot.style.background = this.#normalizeColor(marker.color)
            const name = document.createElement('span')
            name.className = 'marker-list__name'
            name.textContent = marker.title || '未命名'
            const meta = document.createElement('span')
            meta.className = 'marker-list__meta'
            meta.textContent = marker.submap ? '⤵' : marker.minScale > 0 ? `≥${marker.minScale.toFixed(2)}` : '始终'
            item.append(dot, name, meta)
            item.addEventListener('click', () => this.#handlers.onSelect(marker.id))
            this.#list.appendChild(item)
        }
    }

    /** 编辑时不要重绘输入框，只同步标题这类外部变化 */
    syncTitle(title: string) {
        this.#title.textContent = title || '新标记'
    }

    close() {
        this.#mode = 'closed'
        this.#marker = null
        this.element.hidden = true
        this.hideTooltip()
    }

    setStatus(state: SaveState) {
        this.element.dataset.status = state.state
        switch (state.state) {
            case 'saving':
                this.#status.textContent = '保存中…'
                break
            case 'saved':
                this.#status.textContent = `已保存 ${formatTime(state.at)}`
                break
            case 'error':
                this.#status.textContent = `保存失败：${state.message}`
                break
            default:
                this.#status.textContent = ''
        }
    }

    // ------------------------------------------------------------ 内部

    #normalizeColor(color: string) {
        return /^#[0-9a-f]{6}$/i.test(color) ? color : '#ffd166'
    }

    #syncTypeButtons(type: MapMarker['type']) {
        for (const button of this.#typeButtons) {
            button.classList.toggle('is-active', button.dataset.type === type)
        }
    }

    #syncPresetButtons(minScale: number) {
        const tolerance = 0.001
        for (const button of this.#presetButtons) {
            const preset = button.dataset.preset
            let active = false
            if (preset === 'always') active = minScale <= tolerance
            else if (preset === '2' || preset === '4') {
                const expected = this.#fitScale * PRESET_RATIO[preset]
                active = Math.abs(minScale - expected) < Math.max(tolerance * 0.5, 0.02)
            }
            button.classList.toggle('is-active', active)
        }
    }

    #setMinScale(value: number, applyPreset = true) {
        this.#minScaleInput.value = String(Number(value.toFixed(3)))
        if (applyPreset) this.#syncPresetButtons(Number(value.toFixed(3)))
        this.#handlers.onPatch({ minScale: Math.max(0, Number(value.toFixed(3))) })
    }

    #bindEvents() {
        this.element.querySelector('[data-action="close"]')!.addEventListener('click', () => this.#handlers.onClose())
        this.element.querySelector('[data-action="export"]')!.addEventListener('click', () => this.#handlers.onExport())
        this.element.querySelector('[data-action="locate"]')!.addEventListener('click', () => this.#handlers.onLocate())
        this.element.querySelector('[data-action="delete"]')!.addEventListener('click', () => this.#handlers.onDelete())
        this.element.querySelector('[data-action="done"]')!.addEventListener('click', () => this.#handlers.onClose())
        this.#enterButton.addEventListener('click', () => this.#handlers.onEnter())
        this.#previewButton.addEventListener('click', () => this.#handlers.onPreview())

        this.#titleInput.addEventListener('input', () => {
            const title = this.#titleInput.value
            this.#title.textContent = title || '新标记'
            this.#handlers.onPatch({ title })
        })

        this.#colorInput.addEventListener('input', () => {
            this.#handlers.onPatch({ color: this.#colorInput.value })
        })

        for (const button of this.#typeButtons) {
            button.addEventListener('click', () => {
                const type = button.dataset.type === 'label' ? 'label' : 'star'
                this.#syncTypeButtons(type)
                this.#handlers.onPatch({ type })
            })
        }

        for (const button of this.#presetButtons) {
            button.addEventListener('click', () => {
                const preset = button.dataset.preset
                if (preset === 'always') this.#setMinScale(0)
                else if (preset === '2' || preset === '4') this.#setMinScale(this.#fitScale * PRESET_RATIO[preset])
            })
        }

        this.#minScaleInput.addEventListener('input', () => {
            const value = Number(this.#minScaleInput.value)
            if (!Number.isFinite(value)) return
            this.#syncPresetButtons(value)
            this.#handlers.onPatch({ minScale: Math.max(0, Number(value.toFixed(3))) })
        })

        this.#markdownInput.addEventListener('input', () => {
            this.#handlers.onPatch({ markdown: this.#markdownInput.value })
        })

        this.#submapSelect.addEventListener('change', () => {
            this.#handlers.onPatch({ submap: this.#submapSelect.value })
        })

        for (const color of COLOR_PRESETS) {
            const swatch = document.createElement('button')
            swatch.type = 'button'
            swatch.className = 'swatch'
            swatch.style.background = color
            swatch.title = color
            swatch.addEventListener('click', () => {
                this.#colorInput.value = color
                this.#handlers.onPatch({ color })
            })
            this.#swatches.appendChild(swatch)
        }
    }
}
