export class MapReader {
    #className = 'map-reader'
    element: HTMLDivElement
    #map: string
    #image: HTMLImageElement
    constructor(map: string) {
        this.#map = map
        this.element = document.createElement('div')
        this.element.className = this.#className
        this.#image = document.createElement('img')
        this.#image.src = this.#map
        this.#image.draggable = false
        let dpr = window.devicePixelRatio || 1
        this.element.appendChild(this.#image)
        this.#image.style.width = `${this.#image.naturalWidth / dpr}px`
        this.#image.style.height = `${this.#image.naturalHeight / dpr}px`
        this.#bindEvents()
    }
    #bindEvents() {
        this.element.addEventListener('wheel', this.onWheel.bind(this))
        this.element.addEventListener('mousedown', () => {
            this.element.addEventListener('mousemove', this.onMouseMove)
            this.element.addEventListener('mouseup', () => {
                this.element.removeEventListener('mousemove', this.onMouseMove)
            })
        })
    }
    onWheel(e: WheelEvent) {
        e.preventDefault()
        let delta = e.deltaY
        this.#image.style.scale += delta / 1000
    }
    onMouseMove = ((e: MouseEvent) => {
        this.move(e.movementX, e.movementY)
    }).bind(this)
    move(dx: number, dy: number) {
        let olddx = parseFloat(this.#image.style.transform.match(/translate\((-?\d+)px,(-?\d+)px\)/)?.[1] || '0')
        let olddy = parseFloat(this.#image.style.transform.match(/translate\((-?\d+)px,(-?\d+)px\)/)?.[2] || '0')
        this.#image.style.transform = `translate(${olddx + dx}px,${olddy + dy}px)`
    }
}

