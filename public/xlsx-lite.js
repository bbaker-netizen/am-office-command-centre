/* A&M - a very small .xlsx writer, so Danielle gets a real Excel workbook
   rather than a CSV. No library: an .xlsx file is a zip of a few XML files,
   written here with no compression. Arial throughout, bold header rows.
   XLSX.make([{ name, rows:[[cell...]], widths:[..], bold:[rowIndex...] }]) -> Blob
   A cell is a number, a string, or null. */
var XLSX = (function(){
  const enc = new TextEncoder();
  const CRC = (() => { const t = new Uint32Array(256); for(let n = 0; n < 256; n++){ let c = n; for(let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for(let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  const col = i => { let s = ""; i++; while(i > 0){ const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  function sheetXml(sh){
    const bold = new Set(sh.bold || []);
    const cols = (sh.widths || []).length ? '<cols>' + sh.widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join("") + '</cols>' : '';
    const rows = sh.rows.map((r, ri) => '<row r="' + (ri + 1) + '">' + r.map((v, ci) => {
      if(v === null || v === undefined || v === "") return "";
      const ref = col(ci) + (ri + 1), st = bold.has(ri) ? ' s="1"' : (typeof v === "number" ? ' s="2"' : '');
      if(typeof v === "number" && isFinite(v)) return '<c r="' + ref + '"' + st + '><v>' + v + '</v></c>';
      return '<c r="' + ref + '" t="inlineStr"' + st + '><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
    }).join("") + '</row>').join("");
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + cols + '<sheetData>' + rows + '</sheetData></worksheet>';
  }
  function zip(files){
    const parts = [], central = []; let off = 0;
    const u16 = n => [n & 255, (n >>> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    for(const f of files){
      const name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
      const head = [0x50,0x4b,0x03,0x04, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
      parts.push(new Uint8Array(head), name, data);
      central.push(new Uint8Array([0x50,0x4b,0x01,0x02, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), name);
      off += head.length + name.length + data.length;
    }
    const csize = central.reduce((s, x) => s + x.length, 0);
    const end = new Uint8Array([0x50,0x4b,0x05,0x06, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(csize), ...u32(off), ...u16(0)]);
    return new Blob(parts.concat(central, [end]), { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  function make(sheets){
    const names = sheets.map((s, i) => String(s.name || "Sheet " + (i + 1)).replace(/[\\\/\?\*\[\]:]/g, " ").slice(0, 31));
    const files = [
      { name: "[Content_Types].xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + names.map((n, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join("") + '</Types>' },
      { name: "_rels/.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: "xl/workbook.xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + names.map((n, i) => '<sheet name="' + esc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join("") + '</sheets></workbook>' },
      { name: "xl/_rels/workbook.xml.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + names.map((n, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join("") + '<Relationship Id="rId' + (names.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: "xl/styles.xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FF1A1917"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf fontId="0"/><xf fontId="1" applyFont="1"/><xf fontId="0" numFmtId="164" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' }
    ].concat(sheets.map((s, i) => ({ name: "xl/worksheets/sheet" + (i + 1) + ".xml", data: sheetXml(s) })));
    return zip(files);
  }
  return { make };
})();
if(typeof module !== "undefined") module.exports = XLSX;
