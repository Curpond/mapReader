# 地图阅读器（MapReader）

超大图片的「模拟地图」查看器：滚轮以鼠标位置为基准缩放、按住拖动平移、双击缩放，缩放到哪都不会把图片拖丢。支持 `maps/` 目录下放多张地图，用左上角下拉框切换。

现有地图：`maps/吞食天地.png`（5516 × 4636）。

## 运行

ES Module 不能通过 `file://` 打开，必须走 http：

```bash
npm start          # 零依赖本地服务器，默认 http://127.0.0.1:5173
```

改了 `src/*.ts` 之后要重新编译（编译产物在 `dist/`，页面加载的是 `dist/main.js`）：

```bash
npm run build      # 单次编译
npm run watch      # 监听模式
```

> Windows 上如果 `.ps1` 被执行策略禁用，全局命令请用 `tsc.cmd -p tsconfig.json`，不要用 `tsc`。

## 加新地图

把图片丢进 `maps/`，然后重新起服务（`npm start` 会先跑 `npm run maps` 生成清单）：

```bash
npm run maps       # 手动重新扫描 maps/ 生成 maps/manifest.json
```

- 下拉框里的名字就是**文件名（去掉扩展名）**，例如 `maps/吞食天地.png` → `吞食天地`；想改名就重命名文件。
- 支持 `.png .jpg .jpeg .webp .gif .avif .bmp`，按拼音排序。
- 浏览器无法列目录，所以必须由清单文件 `maps/manifest.json` 提供数据（它已提交进仓库，静态部署时直接用）。

## 操作

| 操作 | 效果 |
| --- | --- |
| 左上角下拉框 | 切换要查看的地图（会记住上次的选择） |
| 滚轮上下 | 以鼠标所在位置为基准放大 / 缩小 |
| 按住左键（或中键）拖动 | 平移；指针移出窗口也不会中断 |
| 双击 / Shift + 双击 | 原地放大 / 缩小 |
| `+` `-` | 以视口中心放大 / 缩小 |
| `0` | 恢复全图 |
| 触控板捏合 | 以手势位置缩放 |

## 结构

```
index.html            页面骨架：视口 + 地图选择 + 加载态 + 提示 + 工具条
css/style.css         页面样式（组件关键样式是内联的，不依赖它）
src/mapReader.ts      查看器组件（无框架依赖，纯 DOM）
src/main.ts           应用入口：读清单、切换地图、工具条、快捷键、状态回显
scripts/gen-maps.mjs  扫描 maps/ 生成 maps/manifest.json
scripts/serve.mjs     零依赖静态服务器
maps/                 地图图片 + manifest.json（自动生成）
dist/                 tsc 编译产物（已在 .gitignore 中）
```

## 组件用法

```ts
import { MapReader } from './mapReader.js'

const map = new MapReader('./maps/吞食天地.png', {
    minScale: 0.02,   // 最小缩放倍数（1 = 图片原始像素 1:1）
    maxScale: 8,      // 最大缩放倍数
    wheelSpeed: 0.0016, // 滚轮灵敏度
    pinchSpeed: 0.01,   // 触控板捏合灵敏度
    fitOnLoad: true,    // 加载后自动缩放到完整可见
    constrain: true,    // 限制图片不被拖出视口（小于视口时居中）
    initialScale: 1,    // fitOnLoad 为 false 时的初始倍数
})

// 也可以晚一点再给图片，或者切换地图（同一个实例复用）
const plain = new MapReader('')
plain.load('./maps/另一个地图.png')


document.getElementById('viewport')!.appendChild(map.element)
```

### 方法

| 方法 | 说明 |
| --- | --- |
| `zoomAt(clientX, clientY, factor)` | 以某个视口坐标（通常是 `event.clientX/Y`）为基准缩放，`factor > 1` 放大 |
| `zoomBy(factor)` | 以容器中心为基准缩放 |
| `setScale(scale)` | 缩放到指定倍数（以容器中心为基准） |
| `panBy(dx, dy)` | 平移指定像素 |
| `fit()` | 等比缩放到完整显示整张地图并居中 |
| `reset()` | 回到初始视图 |
| `load(source)` | 切换/重新指定地图，自动重新 fit；同一地址会被忽略 |
| `destroy()` | 移除所有监听并卸载元素 |

### 属性

`source`（当前地址）、`scale`（当前倍数）、`position`（`{ x, y }` 图片左上角坐标）、`naturalSize`（`{ width, height }`）、`isReady`、`view`（`{ x, y, scale }`）、`element`（根元素）。

### 事件

都从 `map.element` 冒泡派发：

- `mapload` — 开始加载/切换，`detail` 为 `{ source }`
- `mapready` — 图片加载完成、首帧视图就绪
- `mapchange` — 视图变化，`detail` 为 `{ x, y, scale }`
- `maperror` — 图片加载失败，`detail` 为 `{ source }`

## 实现要点

- 位移与缩放只保存在三个数值字段里（`x` / `y` / `scale`），每次合成一条 `transform` 写进 style，不从样式字符串反解析。
- 图片的 `transform-origin` 必须是 `0 0`，这样像素坐标到容器坐标是线性的：`(u, v) → (u * scale + x, v * scale + y)`。
- 以光标为基准缩放：缩放前后光标下的图片像素保持不变，即 `x' = px - (px - x) * k`。
- 拖动用 Pointer Events + `setPointerCapture`，取 `clientX/Y` 差值（而不是 `movementX/Y`）累加。
- 图片按 `naturalWidth/Height` 原样布局，不要除以 `devicePixelRatio`。
- 缩放到边界时，光标基准会让位于边界夹紧（否则会出现空白）；图片小于视口时自动居中。
