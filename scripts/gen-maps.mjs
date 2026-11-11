// 扫描 maps/ 生成地图清单，供页面下拉框和「子地图」选择器使用。
// 约定：maps/ 顶层的图片 = 主地图（出现在下拉框）；maps/sub/ 里的 = 子地图（不出现在下拉框）。
// 浏览器无法列目录，所以加图后重跑一次即可（start.bat / npm start / npm run build 会自动跑）。
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const mapsDir = path.dirname(fileURLToPath(new URL('../maps/manifest.json', import.meta.url)))
const manifestPath = path.join(mapsDir, 'manifest.json')
const subDirName = 'sub'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp'])
const collator = new Intl.Collator('zh-Hans', { numeric: true, sensitivity: 'base' })

const isImage = (name) => !name.startsWith('.') && IMAGE_EXT.has(path.extname(name).toLowerCase())
const nameOf = (file) => path.basename(file, path.extname(file))

/** 递归收集目录下的图片，返回相对 maps/ 的路径（正斜杠） */
const collect = async (dir, prefix = '') => {
    let entries = []
    try {
        entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (err) {
        if (err.code === 'ENOENT') return []
        throw err
    }
    const files = []
    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
            files.push(...(await collect(path.join(dir, entry.name), rel)))
        } else if (entry.isFile() && isImage(entry.name)) {
            files.push(rel)
        }
    }
    return files
}

await fs.mkdir(mapsDir, { recursive: true })

const topFiles = (await collect(mapsDir)).filter((file) => !file.startsWith(`${subDirName}/`))
const subFiles = (await collect(path.join(mapsDir, subDirName), subDirName))

const toEntry = (file) => ({ name: nameOf(file), file })
const maps = topFiles.sort(collator.compare).map(toEntry)
const submaps = subFiles.sort(collator.compare).map(toEntry)

await fs.writeFile(manifestPath, `${JSON.stringify({ maps, submaps }, null, 2)}\n`, 'utf8')

console.log(`地图清单已生成：maps/manifest.json（主地图 ${maps.length} 张，子地图 ${submaps.length} 张）`)
for (const map of maps) console.log(`  - 主图 ${map.name}  (${map.file})`)
for (const sub of submaps) console.log(`  - 子图 ${sub.name}  (${sub.file})`)
