/* Minimal dependency-free .xlsx writer + reader (works offline).
   Writer: stored (uncompressed) ZIP with inline strings. Reader: uses the browser's DecompressionStream. */
'use strict';

const XLSX = (() => {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = u8 => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const esc = s => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const col = i => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

  function zip(files) { // files: [{name, data:Uint8Array}]
    const parts = [], central = []; let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, f.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + size;
    }
    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const safeName = (n, used) => { let s = String(n).replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 31) || 'Sheet'; let k = 2, base = s; while (used.has(s.toLowerCase())) s = base.slice(0, 28) + ' ' + k++; used.add(s.toLowerCase()); return s; };

  /* sheets: [{name, rows:[[cell,...]], widths?:[n], header?:true, rtl?:bool}] -> Blob */
  function build(sheets) {
    const used = new Set(), names = sheets.map(s => safeName(s.name, used));
    const sheetXml = s => {
      const rows = s.rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => {
        if (v === null || v === undefined || v === '') return '';
        const ref = col(ci) + (ri + 1), st = s.header && ri === 0 ? ' s="1"' : '';
        return typeof v === 'number' && isFinite(v) ? `<c r="${ref}"${st}><v>${v}</v></c>` : `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      }).join('') + '</row>').join('');
      const cols = s.widths ? '<cols>' + s.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>' : '';
      const pane = s.header ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : '';
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0"${s.rtl ? ' rightToLeft="1"' : ''}>${pane}</sheetView></sheetViews>${cols}<sheetData>${rows}</sheetData></worksheet>`;
    };
    const f = (name, text) => ({ name, data: enc.encode(text) });
    const files = [
      f('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`),
      f('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
      f('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${NS}" xmlns:r="${REL}"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
      f('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`),
      f('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
      ...sheets.map((s, i) => f(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)))
    ];
    return zip(files);
  }

  /* ArrayBuffer -> rows (array of arrays of strings) from the first worksheet */
  async function read(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    let e = u8.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('Not an xlsx file');
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const entries = {};
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt zip');
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      entries[dec.decode(u8.subarray(p + 46, p + 46 + nl))] = { method: dv.getUint16(p + 10, true), csize: dv.getUint32(p + 20, true), lho: dv.getUint32(p + 42, true) };
      p += 46 + nl + el + cl;
    }
    const get = async name => {
      const en = entries[name]; if (!en) return null;
      const nl = dv.getUint16(en.lho + 26, true), el = dv.getUint16(en.lho + 28, true), s = en.lho + 30 + nl + el;
      const data = u8.subarray(s, s + en.csize);
      if (en.method === 0) return dec.decode(data);
      if (en.method === 8) return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
      throw new Error('Unsupported compression');
    };
    const xml = t => new DOMParser().parseFromString(t, 'application/xml');
    let sheetPath = 'xl/worksheets/sheet1.xml';
    const wb = await get('xl/workbook.xml'), rels = await get('xl/_rels/workbook.xml.rels');
    if (wb && rels) {
      const first = xml(wb).getElementsByTagName('sheet')[0]; const rid = first && (first.getAttribute('r:id') || first.getAttributeNS(REL, 'id'));
      const rel = [...xml(rels).getElementsByTagName('Relationship')].find(r => r.getAttribute('Id') === rid);
      if (rel) { const tg = rel.getAttribute('Target'); sheetPath = tg.startsWith('/') ? tg.slice(1) : 'xl/' + tg; }
    }
    const shared = [], ss = await get('xl/sharedStrings.xml');
    if (ss) [...xml(ss).getElementsByTagName('si')].forEach(si => shared.push([...si.getElementsByTagName('t')].map(t => t.textContent).join('')));
    const sh = await get(sheetPath); if (!sh) throw new Error('Sheet not found');
    const rows = [];
    [...xml(sh).getElementsByTagName('row')].forEach(r => {
      const row = [];
      [...r.getElementsByTagName('c')].forEach(c => {
        const ref = c.getAttribute('r') || ''; let ci = 0; for (const ch of ref.replace(/\d+/g, '')) ci = ci * 26 + (ch.charCodeAt(0) - 64); ci--;
        const type = c.getAttribute('t'), v = c.getElementsByTagName('v')[0];
        let val = '';
        if (type === 's' && v) val = shared[+v.textContent] ?? '';
        else if (type === 'inlineStr') val = [...c.getElementsByTagName('t')].map(t => t.textContent).join('');
        else if (v) val = v.textContent;
        row[ci < 0 ? row.length : ci] = String(val).trim();
      });
      if (row.some(x => x)) rows.push(Array.from(row, x => x || ''));
    });
    return rows;
  }
  return { build, read };
})();
