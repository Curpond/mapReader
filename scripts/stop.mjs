// 停止由 start.mjs / start.bat 启动的服务
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const pidFile = path.join(root, '.mapreader.pid')

const readInfo = () => {
    try {
        return JSON.parse(fs.readFileSync(pidFile, 'utf8'))
    } catch {
        return null
    }
}

const removePidFile = () => {
    try {
        fs.rmSync(pidFile, { force: true })
    } catch {
        // 忽略
    }
}

const info = readInfo()
if (!info || typeof info.pid !== 'number') {
    console.log('没有找到正在运行的服务记录，可能已经关掉了。')
    removePidFile()
    process.exit(0)
}

try {
    process.kill(info.pid, 0) // 探测进程是否存在
} catch {
    console.log('服务已经不在运行，清理残留记录。')
    removePidFile()
    process.exit(0)
}

try {
    process.kill(info.pid)
    console.log(`已停止地图阅读器（PID ${info.pid}，${info.url ?? ''}）`)
    console.log('如果还开着那个启动窗口，现在可以关掉它了。')
} catch (err) {
    console.error(`停止失败：${err instanceof Error ? err.message : String(err)}`)
    console.error('可以手动关闭启动时打开的那个命令行窗口。')
}

removePidFile()
