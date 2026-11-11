// 零依赖本地静态服务器（可被 scripts/start.mjs 复用）
// 直接运行：node scripts/serve.mjs [端口]
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DEFAULT_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

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
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
}

const MAX_BODY = 4 * 1024 * 1024

const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_BODY) {
            reject(new Error('请求体过大'))
            req.destroy()
            return
        }
        chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
})

/** 只保留合法字段，避免把乱七八糟的东西写进文件 */
const sanitizeMarkers = (payload) => {
    if (!payload || typeof payload !== 'object' || typeof payload.maps !== 'object' || payload.maps === null) {
        throw new Error('数据格式不正确：缺少 maps')
    }
    const maps = {}
    for (const [file, markers] of Object.entries(payload.maps)) {
        if (typeof file !== 'string' || !Array.isArray(markers)) throw new Error(`地图 ${file} 的数据不正确`)
        maps[file] = markers.map((marker) => {
            const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback)
            // 子地图只能是 maps/ 下的相对路径，不允许跳出目录
            const submap = String(marker?.submap ?? '')
                .replace(/\\/g, '/')
                .replace(/^\/+/, '')
            const safeSubmap = submap.split('/').includes('..') ? '' : submap
            return {
                id: String(marker?.id ?? ''),
                x: num(marker?.x),
                y: num(marker?.y),
                type: marker?.type === 'label' ? 'label' : 'star',
                title: String(marker?.title ?? ''),
                color: String(marker?.color ?? '#ffd166'),
                minScale: num(marker?.minScale),
                markdown: String(marker?.markdown ?? ''),
                submap: safeSubmap,
            }
        })
    }
    return { version: 1, maps }
}

/**
 * 创建一个地图阅读器静态服务器（未 listen）
 * @param {{ root?: string }} options
 */
export const createMapServer = (options = {}) => {
    const root = path.resolve(options.root ?? DEFAULT_ROOT)
    const markersFile = path.join(root, 'data', 'markers.json')

    const saveMarkers = async (req, res) => {
        const json = (status, payload) => {
            res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify(payload))
        }
        try {
            const body = await readBody(req)
            const data = sanitizeMarkers(JSON.parse(body))
            await fs.promises.mkdir(path.dirname(markersFile), { recursive: true })
            // 先写临时文件再改名，避免中途出错把原文件写坏
            const tmpFile = `${markersFile}.tmp`
            await fs.promises.writeFile(tmpFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
            await fs.promises.rename(tmpFile, markersFile)
            const count = Object.values(data.maps).reduce((sum, list) => sum + list.length, 0)
            json(200, { ok: true, count })
            console.log(`标签已保存：data/markers.json（共 ${count} 个）`)
        } catch (err) {
            json(400, { ok: false, error: err instanceof Error ? err.message : String(err) })
        }
    }

    return http.createServer((req, res) => {
        let urlPath
        try {
            urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
        } catch {
            res.writeHead(400).end('bad request')
            return
        }

        // 标签保存接口
        if (urlPath === '/api/markers') {
            if (req.method !== 'POST') {
                res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'POST' })
                res.end('method not allowed')
                return
            }
            void saveMarkers(req, res)
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
}

/**
 * 开始监听；端口被占用时自动往后找
 * @param {import('node:http').Server} server
 * @param {{ port?: number, host?: string, tries?: number }} options
 * @returns {Promise<number>} 实际使用的端口
 */
export const listenMapServer = (server, options = {}) => new Promise((resolve, reject) => {
    const host = options.host ?? '127.0.0.1'
    const tries = options.tries ?? 20
    let attempt = 0

    const tryListen = (port) => {
        const onError = (err) => {
            server.removeListener('listening', onListening)
            if (err.code === 'EADDRINUSE' && attempt < tries) {
                attempt += 1
                tryListen(port + 1)
                return
            }
            reject(err)
        }
        const onListening = () => {
            server.removeListener('error', onError)
            resolve(port)
        }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(port, host)
    }

    tryListen(Number(options.port ?? 5173))
})

// 直接运行本文件时：起服务并打印地址
const isMain = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false
if (isMain) {
    const server = createMapServer()
    const port = await listenMapServer(server, { port: Number(process.argv[2] || process.env.PORT || 5173) })
    console.log(`地图阅读器已启动： http://127.0.0.1:${port}`)
}
