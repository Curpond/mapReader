// 一键启动：生成地图清单 → 必要时编译 → 启动服务 → 自动打开浏览器
// 双击 start.bat 即可；关闭那个黑窗口就等于停止服务。
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMapServer, listenMapServer } from './serve.mjs'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const pidFile = path.join(root, '.mapreader.pid')
const distEntry = path.join(root, 'dist', 'main.js')
const srcDir = path.join(root, 'src')
const TOTAL = 3

const step = (index, text) => console.log(`[${index}/${TOTAL}] ${text}`)
const line = () => console.log('─'.repeat(52))

const openBrowser = (url) => {
    const candidates = process.platform === 'win32'
        ? [['cmd', ['/c', 'start', '', url]]]
        : process.platform === 'darwin'
            ? [['open', [url]]]
            : [['xdg-open', [url]]]
    for (const [command, args] of candidates) {
        try {
            spawn(command, args, { detached: true, stdio: 'ignore' }).unref()
            return true
        } catch {
            // 换下一个候选
        }
    }
    return false
}

/** 已经有实例在跑就复用它，避免开一堆端口 */
const runningInstance = () => {
    try {
        const info = JSON.parse(fs.readFileSync(pidFile, 'utf8'))
        if (!info || typeof info.pid !== 'number') return null
        process.kill(info.pid, 0) // 只探测，不杀
        return info
    } catch {
        return null
    }
}

const isBuildStale = () => {
    if (!fs.existsSync(distEntry)) return true
    const builtAt = fs.statSync(distEntry).mtimeMs
    try {
        return fs
            .readdirSync(srcDir)
            .filter((name) => name.endsWith('.ts'))
            .some((name) => fs.statSync(path.join(srcDir, name)).mtimeMs > builtAt)
    } catch {
        return true
    }
}

const main = async () => {
    const existing = runningInstance()
    if (existing) {
        line()
        console.log('地图阅读器已经在运行了')
        console.log(`地址： ${existing.url}`)
        console.log('（如果要重启，先双击 stop.bat）')
        line()
        openBrowser(existing.url)
        return
    }

    step(1, '扫描 maps\\ 目录，生成地图清单…')
    const mapsResult = spawnSync(process.execPath, [path.join(root, 'scripts', 'gen-maps.mjs')], {
        cwd: root,
        stdio: 'inherit',
    })
    if (mapsResult.status !== 0) {
        console.error('地图清单生成失败，请查看上面的错误信息。')
        process.exitCode = 1
        return
    }

    if (isBuildStale()) {
        step(2, '检测到源码有改动，正在编译 TypeScript…')
        // Windows 上 tsc 是 tsc.cmd，直接执行即可，避免 shell: true 的参数拼接隐患
        const tscCommand = process.platform === 'win32' ? 'tsc.cmd' : 'tsc'
        const buildResult = spawnSync(tscCommand, ['-p', 'tsconfig.json'], {
            cwd: root,
            stdio: 'inherit',
        })
        if (buildResult.error || buildResult.status !== 0) {
            console.error('编译失败。若提示找不到 tsc，请在该目录执行 npm install。')
            process.exitCode = 1
            return
        }
    } else {
        step(2, '代码已是最新，跳过编译')
    }

    step(3, '启动本地服务器…')
    const server = createMapServer({ root })
    const port = await listenMapServer(server, { port: 5173 })
    const url = `http://127.0.0.1:${port}`

    fs.writeFileSync(pidFile, JSON.stringify({ pid: process.pid, port, url }, null, 2), 'utf8')

    if (!process.argv.includes('--no-open')) openBrowser(url)

    console.log('')
    line()
    console.log(' 地图阅读器已启动')
    console.log(` 地址： ${url}`)
    console.log('')
    console.log(' 关闭这个窗口 = 停止服务')
    console.log(' 或者双击 stop.bat 停止（后台进程还在时可用来清理）')
    line()
    console.log('')

    const cleanup = () => {
        try {
            fs.rmSync(pidFile, { force: true })
        } catch {
            // 忽略
        }
    }
    const shutdown = () => {
        cleanup()
        server.close(() => process.exit(0))
        // 兜底：如果有连接没断干净，1 秒后强制退出
        setTimeout(() => process.exit(0), 1000).unref()
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
    process.on('SIGBREAK', shutdown) // Windows 关闭控制台窗口 / Ctrl+Break
    process.on('exit', cleanup)
}

void main()
