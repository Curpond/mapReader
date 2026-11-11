/**
 * 极简 Markdown 渲染器：只覆盖地图标签信息面板需要的子集，无第三方依赖。
 *
 * 支持：标题(#~####)、段落、粗体、斜体、删除线、行内代码、链接、
 *      无序/有序列表、引用、分隔线、表格、软换行。
 *
 * 先整体转义 HTML，再生成标签，所以内容里写 <script> 也只会被当成文字。
 */

const ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
}

const escapeHtml = (text: string): string => text.replace(/[&<>"]/g, (ch) => ESCAPES[ch] ?? ch)

// 行内代码先用占位符藏起来，防止里面的符号被后续规则改写
const OPEN = '\u0000'
const CLOSE = '\u0001'

const renderInline = (text: string): string => {
    const codes: string[] = []
    let out = escapeHtml(text).replace(/`([^`\n]+)`/g, (_match, code: string) => {
        codes.push(`<code>${code}</code>`)
        return `${OPEN}${codes.length - 1}${CLOSE}`
    })

    out = out
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
        .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
        .replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>')

    return out.replace(
        new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g'),
        (_match, index: string) => codes[Number(index)] ?? '',
    )
}

/** 把一行表格拆成单元格 */
const splitRow = (line: string): string[] =>
    line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((cell) => cell.trim())

const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

export const renderMarkdown = (source: string): string => {
    const lines = source.replace(/\r\n?/g, '\n').split('\n')
    const html: string[] = []
    let i = 0

    while (i < lines.length) {
        const line = lines[i] ?? ''

        if (!line.trim()) {
            i += 1
            continue
        }

        // 分隔线
        if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
            html.push('<hr>')
            i += 1
            continue
        }

        // 标题
        const heading = /^(#{1,4})\s+(.*)$/.exec(line)
        if (heading) {
            const level = (heading[1] ?? '').length
            html.push(`<h${level}>${renderInline(heading[2] ?? '')}</h${level}>`)
            i += 1
            continue
        }

        // 表格：当前行含 |，下一行是分隔行
        if (line.includes('|') && TABLE_DIVIDER.test(lines[i + 1] ?? '') && (lines[i + 1] ?? '').includes('-')) {
            const head = splitRow(line)
            const aligns = splitRow(lines[i + 1] ?? '').map((cell) => {
                const left = cell.startsWith(':')
                const right = cell.endsWith(':')
                return left && right ? 'center' : right ? 'right' : ''
            })
            const alignStyle = (index: number) => {
                const align = aligns[index]
                return align ? ` style="text-align:${align}"` : ''
            }
            i += 2
            const rows: string[] = []
            while (i < lines.length && (lines[i] ?? '').includes('|')) {
                const cells = splitRow(lines[i] ?? '')
                rows.push(
                    `<tr>${cells.map((cell, index) => `<td${alignStyle(index)}>${renderInline(cell)}</td>`).join('')}</tr>`,
                )
                i += 1
            }
            html.push(
                `<table><thead><tr>${head
                    .map((cell, index) => `<th${alignStyle(index)}>${renderInline(cell)}</th>`)
                    .join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`,
            )
            continue
        }

        // 引用
        if (/^\s*>\s?/.test(line)) {
            const quoted: string[] = []
            while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? '')) {
                quoted.push((lines[i] ?? '').replace(/^\s*>\s?/, ''))
                i += 1
            }
            html.push(`<blockquote>${renderMarkdown(quoted.join('\n'))}</blockquote>`)
            continue
        }

        // 无序列表
        if (/^\s*[-*+]\s+/.test(line)) {
            const items: string[] = []
            while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i] ?? '')) {
                items.push(`<li>${renderInline((lines[i] ?? '').replace(/^\s*[-*+]\s+/, ''))}</li>`)
                i += 1
            }
            html.push(`<ul>${items.join('')}</ul>`)
            continue
        }

        // 有序列表
        if (/^\s*\d+[.)]\s+/.test(line)) {
            const items: string[] = []
            while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i] ?? '')) {
                items.push(`<li>${renderInline((lines[i] ?? '').replace(/^\s*\d+[.)]\s+/, ''))}</li>`)
                i += 1
            }
            html.push(`<ol>${items.join('')}</ol>`)
            continue
        }

        // 段落：连续非空、且不是其他块起始的行
        const paragraph: string[] = []
        while (i < lines.length) {
            const current = lines[i] ?? ''
            if (
                !current.trim() ||
                /^(#{1,4})\s+/.test(current) ||
                /^\s*[-*+]\s+/.test(current) ||
                /^\s*\d+[.)]\s+/.test(current) ||
                /^\s*>\s?/.test(current) ||
                /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(current)
            ) {
                break
            }
            paragraph.push(current)
            i += 1
        }
        if (paragraph.length > 0) {
            html.push(`<p>${paragraph.map((text) => renderInline(text)).join('<br>')}</p>`)
        }
    }

    return html.join('\n')
}

/** 提取纯文本，用于悬停预览和列表摘要 */
export const markdownToPlain = (source: string): string =>
    source
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/^\s*>\s?/gm, '')
        .replace(/^\s*[-*+]\s+/gm, '')
        .replace(/^\s*\d+[.)]\s+/gm, '')
        .replace(/^\s*\|?\s*:?-{2,}:?.*$/gm, ' ')
        .replace(/[*_`~|]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
