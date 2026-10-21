/* ============================================================
   共读札记 · 读书笔记导出 DOCX (export.js)
   浏览器端使用 docx.js 生成 .docx，数据不出本地
   ============================================================ */

(function () {
  'use strict';
  const GD = window.GD;

  // docx.js CDN 地址（unpkg 优先，jsdelivr 兜底）
  const DOCX_CDNS = [
    'https://unpkg.com/docx@8.5.0/build/index.js',
    'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.js'
  ];

  let docxLib = null;
  let libLoading = null;

  function loadDocx() {
    if (docxLib) return Promise.resolve(docxLib);
    if (libLoading) return libLoading;

    libLoading = new Promise((resolve, reject) => {
      let i = 0;
      (function tryNext() {
        if (i >= DOCX_CDNS.length) { reject(new Error('docx.js 加载失败')); return; }
        const s = document.createElement('script');
        s.src = DOCX_CDNS[i++];
        s.onload = () => { docxLib = window.docx; resolve(docxLib); };
        s.onerror = () => tryNext();
        document.head.appendChild(s);
      })();
    });
    return libLoading;
  }

  /* ---------------- 导出主函数 ---------------- */
  async function exportDocx({ user, start, end, entries, comments }) {
    const docx = await loadDocx();
    if (!docx) throw new Error('docx 库未加载');

    // 过滤条目
    let list = entries.slice();
    if (user !== 'all') list = list.filter(e => e.user === user);
    list = list.filter(e => e.date >= start && e.date <= end);
    list.sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : (a.date < b.date ? -1 : 1)));

    if (!list.length) throw new Error('所选范围内没有读书输出');

    // 聚合统计
    const userLabel = user === 'all' ? '两人全部' : user;
    const byUser = {};
    list.forEach(e => { byUser[e.user] = (byUser[e.user] || 0) + 1; });
    const days = new Set(list.map(e => e.date)).size;
    const statLines = Object.keys(byUser).map(u => `${u}：${byUser[u]} 条`).join('，');

    // 按日期分组
    const byDate = {};
    list.forEach(e => { (byDate[e.date] = byDate[e.date] || []).push(e); });
    const dateKeys = Object.keys(byDate).sort();

    const children = [];

    // 封面标题
    children.push(new docx.Paragraph({
      alignment: docx.AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new docx.TextRun({ text: '共读札记 · 读书输出记录', bold: true, size: 36, font: '宋体' })]
    }));
    children.push(new docx.Paragraph({
      alignment: docx.AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [new docx.TextRun({ text: `用户：${userLabel}　|　时间：${start} 至 ${end}　|　共 ${list.length} 条 / ${days} 天`, size: 21, color: '666666', font: '宋体' })]
    }));
    children.push(new docx.Paragraph({
      alignment: docx.AlignmentType.CENTER,
      spacing: { after: 600 },
      children: [new docx.TextRun({ text: `统计：${statLines}`, size: 21, color: '8A6D3B', font: '宋体' })]
    }));

    // 逐日输出
    dateKeys.forEach(date => {
      children.push(new docx.Paragraph({
        spacing: { before: 300, after: 150 },
        border: { bottom: { size: 6, color: 'A03028', space: 4 } },
        children: [new docx.TextRun({ text: `—— ${date} ——`, bold: true, size: 26, color: 'A03028', font: '宋体' })]
      }));

      byDate[date].forEach(e => {
        const c = comments.filter(x => x.entryId === e.id).sort((a, b) => a.createdAt - b.createdAt);
        children.push(new docx.Paragraph({
          spacing: { before: 200, after: 80 },
          children: [
            new docx.TextRun({ text: `【${e.user}】《${e.bookTitle}》　`, bold: true, size: 24, font: '宋体' }),
            new docx.TextRun({ text: `${GD.fmtDateTime(e.createdAt)}`, size: 18, color: '999999', font: '宋体' })
          ]
        }));
        e.content.split('\n').forEach(line => {
          children.push(new docx.Paragraph({
            indent: { left: 420 },
            spacing: { after: 60 },
            children: [new docx.TextRun({ text: line, size: 22, font: '宋体' })]
          }));
        });
        // 评论
        if (c.length) {
          c.forEach(cmt => {
            children.push(new docx.Paragraph({
              indent: { left: 560 },
              spacing: { after: 40 },
              children: [
                new docx.TextRun({ text: `—— ${cmt.user} 回复：`, italics: true, size: 20, color: '8A6D3B', font: '宋体' }),
                new docx.TextRun({ text: cmt.content, size: 20, color: '555555', font: '宋体' })
              ]
            }));
          });
        }
      });
    });

    children.push(new docx.Paragraph({
      spacing: { before: 600 },
      alignment: docx.AlignmentType.CENTER,
      children: [new docx.TextRun({ text: '—— 共读札记 · 以书会友 ——', size: 18, color: '999999', font: '宋体' })]
    }));

    const doc = new docx.Document({
      sections: [{
        properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
        children
      }]
    });

    const blob = await docx.Packer.toBlob(doc);
    GD.downloadBlob(blob, `读书笔记_${userLabel}_${start}_至_${end}.docx`);
    return true;
  }

  window.exportDocx = exportDocx;
})();
