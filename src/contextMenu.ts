/**
 * 通用右键菜单：给标签/地图空白处提供可扩展的上下文操作。
 *
 * 用法：menu.open({ x, y, items })；items 里可以插分隔线（{ separator: true }）。
 */
export interface MenuItem {
    label?: string
    icon?: string
    hint?: string
    disabled?: boolean
    danger?: boolean
    separator?: boolean
    onSelect?: () => void
}

export interface OpenMenuOptions {
    x: number
    y: number
    title?: string
    items: MenuItem[]
}

export class ContextMenu {
    readonly element: HTMLDivElement
    #open = false

    constructor() {
        this.element = document.createElement('div')
        this.element.className = 'ctx-menu'
        this.element.hidden = true
        this.element.setAttribute('role', 'menu')

        // 点击别处 / Esc / 滚轮 / 窗口尺寸变化都关闭
        window.addEventListener('pointerdown', this.#onDocumentPointerDown, true)
        window.addEventListener('keydown', this.#onKeyDown, true)
        window.addEventListener('wheel', this.#onWheel, true)
        window.addEventListener('resize', this.#onResize)
    }

    get isOpen() {
        return this.#open
    }

    open(options: OpenMenuOptions) {
        this.element.textContent = ''

        if (options.title) {
            const title = document.createElement('div')
            title.className = 'ctx-menu__title'
            title.textContent = options.title
            this.element.appendChild(title)
        }

        for (const item of options.items) {
            if (item.separator) {
                const line = document.createElement('div')
                line.className = 'ctx-menu__sep'
                this.element.appendChild(line)
                continue
            }
            const button = document.createElement('button')
            button.type = 'button'
            button.className = 'ctx-menu__item'
            button.setAttribute('role', 'menuitem')
            if (item.danger) button.classList.add('is-danger')
            if (item.disabled) button.disabled = true

            if (item.icon) {
                const icon = document.createElement('span')
                icon.className = 'ctx-menu__icon'
                icon.textContent = item.icon
                button.appendChild(icon)
            }
            const label = document.createElement('span')
            label.className = 'ctx-menu__label'
            label.textContent = item.label ?? ''
            button.appendChild(label)

            if (item.hint) {
                const hint = document.createElement('span')
                hint.className = 'ctx-menu__hint'
                hint.textContent = item.hint
                button.appendChild(hint)
            }

            button.addEventListener('click', () => {
                if (item.disabled) return
                this.close()
                item.onSelect?.()
            })
            this.element.appendChild(button)
        }

        this.element.hidden = false
        this.#open = true

        // 先量尺寸，再夹在视口内
        const rect = this.element.getBoundingClientRect()
        const margin = 8
        let left = options.x
        let top = options.y
        if (left + rect.width > window.innerWidth - margin) left = Math.max(margin, options.x - rect.width)
        if (top + rect.height > window.innerHeight - margin) top = Math.max(margin, options.y - rect.height)
        this.element.style.left = `${left}px`
        this.element.style.top = `${top}px`
    }

    close() {
        if (!this.#open) return
        this.#open = false
        this.element.hidden = true
        this.element.textContent = ''
    }

    destroy() {
        window.removeEventListener('pointerdown', this.#onDocumentPointerDown, true)
        window.removeEventListener('keydown', this.#onKeyDown, true)
        window.removeEventListener('wheel', this.#onWheel, true)
        window.removeEventListener('resize', this.#onResize)
        this.element.remove()
    }

    #onDocumentPointerDown = (e: PointerEvent) => {
        if (!this.#open) return
        // 点在菜单内部由按钮自己处理
        if (e.target instanceof Node && this.element.contains(e.target)) return
        this.close()
    }

    #onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && this.#open) {
            e.stopPropagation()
            this.close()
        }
    }

    #onWheel = () => {
        this.close()
    }

    #onResize = () => {
        this.close()
    }
}
