// 零依赖本地静态服务器：ES Module 不能用 file:// 打开，开发时用它起服务
// 用法：node scripts/serve.mjs [端口]
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const port = Number(process.argv[2] || process.env.PORT || 5173)

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
}

const server = http.createServer((req, res) => {
    let urlPath
    try {
        urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    } catch {
        res.writeHead(400).end('bad request')
        return
    }

    if (urlPath === '/' || urlPath.endsWith('/')) urlPath += 'index.html'

    const filePath = path.join(root, urlPath)
    // 防目录穿越
    if (!filePath.startsWith(root + path.sep)) {
        res.writeHead(403).end('forbidden')
        return
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end(`404 not found: ${urlPath}`)
            return
        }
        res.writeHead(200, {
            'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-cache',
        })
        res.end(data)
    })
})

server.listen(port, '127.0.0.1', () => {
    console.log(`地图阅读器已启动： http://127.0.0.1:${port}`)
})
