/*!
 * markdown-lite.js —— 零依赖的轻量 Markdown 渲染器（浏览器 UMD）
 *
 * 覆盖：标题、粗体/斜体/删除线、行内代码、围栏代码块、引用、
 *       有序/无序列表（含一层以上嵌套）、链接、图片、表格、水平分割线、段落。
 * 安全：所有用户输入先做 HTML 转义；URL 白名单过滤；输出后再做一次 XSS 清理。
 * 说明：不支持内嵌原始 HTML（会被转义为纯文本），这是本机预览工具的有意取舍。
 */
(function (global) {
  'use strict';

  /** HTML 转义：所有用户文本进入渲染管线前必须先经过这里。 */
  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** URL 安全过滤：拒绝 javascript: / vbscript: / data: 与空白控制字符。 */
  function safeUrl(url) {
    const cleaned = String(url || '')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim();
    if (/^\s*(javascript|vbscript|data)\s*:/i.test(cleaned)) return '#';
    return cleaned;
  }

  /** 渲染后的兜底 XSS 清理（剥离 script、危险标签、on* 属性、javascript: 链接）。 */
  function sanitize(html) {
    return String(html)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
      .replace(/<\/?script\b[^>]*>/gi, '')
      .replace(/<\/?(iframe|object|embed|style|link|meta|base|form|frameset)\b[^>]*>/gi, '')
      .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/(href|src)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|\s*javascript:[^\s>]+)/gi, '$1="#"')
      .replace(/javascript\s*:/gi, 'javascript&#58;');
  }

  /** 行内语法解析。输入是未经转义的纯文本，输出是安全的 HTML 片段。 */
  function inline(text) {
    const stash = [];
    function hold(html) {
      stash.push(html);
      return '\u0001' + (stash.length - 1) + '\u0001';
    }

    // 1) 行内代码先提取并占位，避免内部内容被其它语法二次解析
    let s = String(text == null ? '' : text).replace(/(`+)([\s\S]*?)\1/g, function (_m, _ticks, code) {
      return hold('<code>' + escapeHtml(code.replace(/^ | $/g, '')) + '</code>');
    });

    // 2) 剩余文本整体转义，之后插入的标签全部由本渲染器构造
    s = escapeHtml(s);

    // 3) 图片 ![alt](url) —— 文本已整体转义过，URL 不能再二次转义
    s = s.replace(/!\[([^\]]*)\]\(\s*([^\s)]+)\s*\)/g, function (_m, alt, url) {
      return hold('<img src="' + safeUrl(url) + '" alt="' + alt + '" loading="lazy">');
    });

    // 4) 链接 [text](url)
    s = s.replace(/\[([^\]]+)\]\(\s*([^\s)]+)\s*\)/g, function (_m, label, url) {
      return hold('<a href="' + safeUrl(url) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>');
    });

    // 5) 强调 / 删除线
    s = s.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/___([^_\n]+)___/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');

    // 6) 恢复占位内容
    s = s.replace(/\u0001(\d+)\u0001/g, function (_m, index) {
      return stash[Number(index)] || '';
    });
    return s;
  }

  function isListLine(line) {
    return /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.test(line);
  }

  function splitTableRow(line) {
    let s = String(line).trim();
    if (s.charAt(0) === '|') s = s.slice(1);
    if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
    return s.split('|').map(function (cell) { return cell.trim(); });
  }

  function isTableDivider(line) {
    if (!line || (line.indexOf('|') === -1 && line.indexOf('-') === -1)) return false;
    const cells = splitTableRow(line);
    return cells.length > 0 && cells.every(function (cell) {
      return /^:?-{1,}:?$/.test(cell.trim());
    });
  }

  function isHorizontalRule(line) {
    return /^\s*(?:\*\s*){3,}$/.test(line) ||
      /^\s*(?:-\s*){3,}$/.test(line) ||
      /^\s*(?:_\s*){3,}$/.test(line);
  }

  function isBlockStart(lines, i) {
    const line = lines[i];
    if (/^\s*(`{3,}|~{3,})/.test(line)) return true;
    if (/^#{1,6}\s+/.test(line)) return true;
    if (/^\s*>/.test(line)) return true;
    if (isHorizontalRule(line)) return true;
    if (isListLine(line)) return true;
    if (line.indexOf('|') !== -1 && i + 1 < lines.length && isTableDivider(lines[i + 1])) return true;
    return false;
  }

  function buildTable(header, rows, dividerLine) {
    const aligns = splitTableRow(dividerLine).map(function (cell) {
      const t = cell.trim();
      if (t.charAt(0) === ':' && t.charAt(t.length - 1) === ':') return 'center';
      if (t.charAt(t.length - 1) === ':') return 'right';
      return 'left';
    });
    function attr(n) {
      return ' style="text-align:' + (aligns[n] || 'left') + '"';
    }

    let html = '<table><thead><tr>';
    header.forEach(function (cell, n) {
      html += '<th' + attr(n) + '>' + inline(cell) + '</th>';
    });
    html += '</tr></thead>';
    if (rows.length > 0) {
      html += '<tbody>';
      rows.forEach(function (row) {
        html += '<tr>';
        for (let n = 0; n < header.length; n += 1) {
          html += '<td' + attr(n) + '>' + inline(row[n] || '') + '</td>';
        }
        html += '</tr>';
      });
      html += '</tbody>';
    }
    return html + '</table>';
  }

  function normalizeIndent(spaces) {
    return String(spaces).replace(/\t/g, '  ').length;
  }

  /**
   * 把连续列表行渲染成嵌套的 ul/ol。
   * 返回 { html, next }，next 为下一个未消费的行索引对应的 items 下标。
   */
  function buildListLevel(items, start, indent) {
    const tag = items[start].ordered ? 'ol' : 'ul';
    let html = '<' + tag + '>';
    let i = start;

    while (i < items.length) {
      const item = items[i];
      if (item.indent < indent) break;
      if (item.indent > indent) { i += 1; continue; }

      let inner = inline(item.text);
      item.extras.forEach(function (extra) {
        if (extra) inner += '<br>' + inline(extra);
      });

      // 紧随其后、缩进更大的项作为子列表；缩进变小则回到上一级继续渲染
      let next = i + 1;
      if (next < items.length && items[next].indent > indent) {
        const sub = buildListLevel(items, next, items[next].indent);
        inner += sub.html;
        i = sub.next;
      } else {
        i = next;
      }
      html += '<li>' + inner + '</li>';
    }
    return { html: html + '</' + tag + '>', next: i };
  }

  function renderList(lines) {
    const items = [];
    for (let i = 0; i < lines.length; i += 1) {
      const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
      if (m) {
        items.push({
          indent: normalizeIndent(m[1]),
          ordered: /\d/.test(m[2]),
          text: m[3],
          extras: [],
        });
      } else if (items.length > 0) {
        const extra = lines[i].trim();
        if (extra) items[items.length - 1].extras.push(extra);
      }
    }
    if (items.length === 0) return '';
    let base = Infinity;
    items.forEach(function (item) { base = Math.min(base, item.indent); });
    return buildListLevel(items, 0, base).html;
  }

  /** 块级解析主循环。 */
  function renderBlocks(lines) {
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (/^\s*$/.test(line)) { i += 1; continue; }

      // 围栏代码块
      const fence = /^\s*(`{3,}|~{3,})\s*([^\s`]*)\s*$/.exec(line);
      if (fence) {
        const marker = fence[1].charAt(0); // ` 或 ~，无需正则转义
        const minLen = fence[1].length;
        const closeRe = new RegExp('^\\s*' + marker + '{' + minLen + ',}\\s*$');
        const body = [];
        i += 1;
        while (i < lines.length && !closeRe.test(lines[i])) {
          body.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;
        const lang = fence[2].replace(/[^a-zA-Z0-9_+-]/g, '');
        const cls = lang ? ' class="language-' + escapeHtml(lang) + '"' : '';
        out.push('<pre><code' + cls + '>' + escapeHtml(body.join('\n')) + '</code></pre>');
        continue;
      }

      // 标题
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        const level = heading[1].length;
        const text = heading[2].replace(/\s+#+\s*$/, '');
        out.push('<h' + level + '>' + inline(text) + '</h' + level + '>');
        i += 1;
        continue;
      }

      // 水平分割线
      if (isHorizontalRule(line)) {
        out.push('<hr>');
        i += 1;
        continue;
      }

      // 引用（递归渲染内部块）
      if (/^\s*>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*>\s?/, ''));
          i += 1;
        }
        out.push('<blockquote>' + renderBlocks(buf) + '</blockquote>');
        continue;
      }

      // 表格
      if (line.indexOf('|') !== -1 && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
        const header = splitTableRow(line);
        const dividerLine = lines[i + 1];
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].indexOf('|') !== -1 && !/^\s*$/.test(lines[i])) {
          rows.push(splitTableRow(lines[i]));
          i += 1;
        }
        out.push(buildTable(header, rows, dividerLine));
        continue;
      }

      // 列表：空行后若仍是「同类型、缩进不小于根级」的列表行才继续合并，
      // 否则断开，避免把无序列表和有序列表错误地拼成一个 <ul>。
      if (isListLine(line)) {
        const first = /^(\s*)([-*+]|\d+[.)])\s+/.exec(line);
        const rootIndent = normalizeIndent(first[1]);
        const rootOrdered = /\d/.test(first[2]);
        const buf = [];
        while (i < lines.length) {
          if (isListLine(lines[i])) {
            buf.push(lines[i]);
            i += 1;
            continue;
          }
          if (/^\s{2,}\S/.test(lines[i])) {
            buf.push(lines[i]);
            i += 1;
            continue;
          }
          if (/^\s*$/.test(lines[i])) {
            const next = lines[i + 1];
            const nm = next === undefined ? null : /^(\s*)([-*+]|\d+[.)])\s+/.exec(next);
            const isContinuation = !!nm &&
              (/\d/.test(nm[2])) === rootOrdered &&
              normalizeIndent(nm[1]) >= rootIndent;
            if (isContinuation) {
              buf.push('');
              i += 1;
              continue;
            }
            break;
          }
          break;
        }
        out.push(renderList(buf));
        continue;
      }

      // 普通段落
      const para = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !isBlockStart(lines, i)) {
        para.push(lines[i]);
        i += 1;
      }
      if (para.length > 0) {
        out.push('<p>' + para.map(inline).join('<br>') + '</p>');
      } else {
        i += 1; // 兜底，避免死循环
      }
    }
    return out.join('\n');
  }

  /** 对外主入口：Markdown 文本 -> 安全 HTML。 */
  function render(markdown) {
    const normalized = String(markdown == null ? '' : markdown).replace(/\r\n?/g, '\n');
    return sanitize(renderBlocks(normalized.split('\n')));
  }

  const api = { render: render, sanitize: sanitize, escapeHtml: escapeHtml };

  global.MarkdownLite = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
