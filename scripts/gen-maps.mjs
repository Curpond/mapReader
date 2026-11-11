// 扫描 maps/ 目录生成地图清单，供页面下拉框使用。
// 浏览器无法列目录，所以加一张图后重跑一次即可（npm start / npm run build 会自动跑）。
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const mapsDir = path.dirname(fileURLToPath(new URL('../maps/manifest.json', import.meta.url)))
const manifestPath = path.join(mapsDir, 'manifest.json')

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp'])
const collator = new Intl.Collator('zh-Hans', { numeric: true, sensitivity: 'base' })

let entries = []
try {
    entries = await fs.readdir(mapsDir, { withFileTypes: true })
} catch (err) {
    if (err.code === 'ENOENT') {
        await fs.mkdir(mapsDir, { recursive: true })
    } else {
        throw err
    }
}

const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('.') && IMAGE_EXT.has(path.extname(name).toLowerCase()))
    .sort(collator.compare)

// 地图名默认取文件名（去掉扩展名）
const maps = files.map((file) => ({ name: path.basename(file, path.extname(file)), file }))

await fs.writeFile(manifestPath, `${JSON.stringify({ maps }, null, 2)}\n`, 'utf8')

console.log(`地图清单已生成：maps/manifest.json（共 ${maps.length} 张）`)
for (const map of maps) console.log(`  - ${map.name}  (${map.file})`)
