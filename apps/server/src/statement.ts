import ExcelJS from 'exceljs';
import type { Cell } from '@lifty/core';

/**
 * Lee el archivo de movimientos que se baja de la web del banco o de la tarjeta y devuelve las
 * filas tal cual (la interpretación la hace la app con `detectColumns`). Acepta:
 * - Excel .xlsx (la hoja con más filas),
 * - CSV o TXT (separado por ; , o tabulación; en UTF-8 o Latin-1),
 * - "Excel" que en realidad es una tabla HTML (lo que exportan muchos bancos con extensión .xls).
 * El .xls viejo (binario) no se puede leer: hay que guardarlo como .xlsx o CSV.
 */
export class StatementFileError extends Error {}

const MAX_ROWS = 5000;

export async function readStatementFile(buf: Buffer): Promise<Cell[][]> {
  if (buf.length < 4) throw new StatementFileError('El archivo está vacío.');
  if (buf[0] === 0x50 && buf[1] === 0x4b) return readXlsx(buf);
  if (buf[0] === 0xd0 && buf[1] === 0xcf)
    throw new StatementFileError(
      'Es un Excel viejo (.xls). Abrilo en Excel o LibreOffice y guardalo como .xlsx o .csv, y probá de nuevo.',
    );
  if (buf[0] === 0x25 && buf[1] === 0x50) throw new StatementFileError('Es un PDF: bajá los movimientos en Excel o CSV.');
  const text = decode(buf);
  const rows: Cell[][] = /<\s*(table|tr)\b/i.test(text)
    ? readHtml(text)
    : readCsv(text).map((r) => r.map((v) => (v.trim() === '' ? null : v.trim())));
  return clean(rows);
}

async function readXlsx(buf: Buffer): Promise<Cell[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  let best: ExcelJS.Worksheet | null = null;
  for (const ws of wb.worksheets) if (!best || ws.actualRowCount > best.actualRowCount) best = ws;
  if (!best) return [];
  const rows: Cell[][] = [];
  best.eachRow({ includeEmpty: true }, (row) => {
    if (rows.length >= MAX_ROWS) return;
    const cells: Cell[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cells[col - 1] = toCell(cell.value);
    });
    rows.push(Array.from(cells, (c) => c ?? null));
  });
  return clean(rows);
}

function toCell(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  if (typeof v === 'object') {
    if ('result' in v) {
      const r = (v as { result?: unknown }).result;
      if (r instanceof Date) return r.toISOString().slice(0, 10);
      return typeof r === 'number' || typeof r === 'string' ? r : null;
    }
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String((v as { text: unknown }).text);
  }
  return null;
}

/** UTF-8 si se puede; si aparecen caracteres inválidos, Latin-1 (lo que usan muchos bancos). */
function decode(buf: Buffer): string {
  const utf = buf.toString('utf8').replace(/^﻿/, '');
  return utf.includes('�') ? buf.toString('latin1') : utf;
}

function readCsv(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const sample = lines.slice(0, 20).join('\n');
  const count = (ch: string) => sample.split(ch).length - 1;
  const sep = [';', '\t', ','].sort((a, b) => count(b) - count(a))[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length && rows.length < MAX_ROWS; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function readHtml(html: string): Cell[][] {
  const rows: Cell[][] = [];
  for (const tr of html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []) {
    if (rows.length >= MAX_ROWS) break;
    const cells = (tr.match(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi) ?? []).map((td) => {
      const t = td
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e: string) =>
          e.startsWith('#x')
            ? String.fromCharCode(parseInt(e.slice(2), 16))
            : e.startsWith('#')
              ? String.fromCharCode(Number(e.slice(1)))
              : (ENTITIES[e.toLowerCase()] ?? m),
        )
        .replace(/\s+/g, ' ')
        .trim();
      return t === '' ? null : t;
    });
    rows.push(cells);
  }
  return rows;
}

/** Sin filas vacías (ni las columnas vacías del final). */
function clean(rows: Cell[][]): Cell[][] {
  return rows
    .map((r) => {
      let end = r.length;
      while (end > 0 && (r[end - 1] === null || r[end - 1] === '')) end--;
      return r.slice(0, end);
    })
    .filter((r) => r.length > 0)
    .slice(0, MAX_ROWS);
}
