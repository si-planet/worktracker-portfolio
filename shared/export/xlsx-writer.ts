import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { SaxesParser, type SaxesTagNS } from 'saxes';
import { EXPORT_LIMITS, ExportError } from '../schema/export-dataset';
import { reverseWorkbookModelV6, type WorkbookModelV6 } from './v6-workbook';
import type { ExportPairAdapterV6 } from './v6-pair';
import {
  assertExcelText,
  reverseWorkbookModel,
  reverseWorkbookModelV2,
  reverseWorkbookModelV3,
  reverseWorkbookModelV4,
  reverseWorkbookModelV5,
  type AnyWorkbookModelV5,
  type ExportCell,
  type ExportSheet,
  type WorkbookModel,
  type WorkbookModelV2,
  type WorkbookModelV3,
  type WorkbookModelV4,
  type WorkbookModelV5,
} from './workbook-model';
import type {
  ExportPairAdapter,
  ExportPairAdapterV2,
  ExportPairAdapterV3,
  ExportPairAdapterV4,
  ExportPairAdapterV5,
} from './pair';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const MAX_PARTS = 128;
// Bounds apply before decompression and again to each decompressed chunk.
const MAX_XML_BYTES = EXPORT_LIMITS.pairBytes * 8;
const namespaces = new Set([
  MAIN,
  REL,
  PKG,
  TYPES,
  XMLNS,
  'http://www.w3.org/XML/1998/namespace',
  'http://schemas.openxmlformats.org/drawingml/2006/main',
  'http://schemas.openxmlformats.org/package/2006/metadata/core-properties',
  'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties',
  'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes',
  'http://purl.org/dc/elements/1.1/',
  'http://purl.org/dc/terms/',
  'http://purl.org/dc/dcmitype/',
  'http://www.w3.org/2001/XMLSchema-instance',
  'http://schemas.openxmlformats.org/markup-compatibility/2006',
  'http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac',
  'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main',
  'http://schemas.microsoft.com/office/spreadsheetml/2010/11/main',
  'http://schemas.microsoft.com/office/spreadsheetml/2015/02/main',
]);
function mismatch(): never {
  throw new ExportError('PAIR_MISMATCH');
}
function limit(kind: 'physicalCells' | 'pairBytes'): never {
  throw new ExportError('EXPORT_LIMIT_EXCEEDED', kind);
}
function columnName(index: number): string {
  let result = '';
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26))
    result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
  return result;
}
/** ST_Xstring encoding preserves CR/DEL and literal escape-looking input. */
function officeText(text: string): string {
  assertExcelText(text);
  return text
    .replace(/_(?=x[0-9a-fA-F]{4}_)/g, '_x005F_')
    .replace(/\r/g, '_x000D_')
    .replace(/\u007f/g, '_x007F_');
}
/** A single pass is essential: an escaped underscore must not be decoded twice. */
function readOfficeText(text: string): string {
  const value = text.replace(/_x([0-9a-fA-F]{4})_/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
  assertExcelText(value);
  return value;
}
function checkModel(
  model: AnyWorkbookModelV5 | WorkbookModelV6,
  projectionVersion: 1 | 2 | 3 | 4 | 5 | 6,
): void {
  if (
    model.projectionVersion !== projectionVersion ||
    model.sheets.length === 0 ||
    model.sheets.length > 64
  )
    mismatch();
  const names = new Set<string>();
  let cells = 0;
  for (const sheet of model.sheets) {
    if (
      !sheet.name ||
      sheet.name.length > 31 ||
      /[\\/?*[\]:]/.test(sheet.name) ||
      sheet.name.startsWith("'") ||
      sheet.name.endsWith("'") ||
      names.has(sheet.name.toLowerCase())
    )
      mismatch();
    names.add(sheet.name.toLowerCase());
    assertExcelText(sheet.name);
    if (!sheet.columns.length || sheet.columns.length > 16384 || sheet.rows.length + 1 > 1048576)
      limit('physicalCells');
    cells += (sheet.rows.length + 1) * sheet.columns.length;
    if (cells > EXPORT_LIMITS.physicalCells) limit('physicalCells');
    if (sheet.freezeRows !== 1 || sheet.wrapText !== true || typeof sheet.autoFilter !== 'boolean')
      mismatch();
    for (const heading of sheet.columns) {
      assertExcelText(heading);
      if (heading.length > 30000 || (heading.match(/\n/g)?.length ?? 0) > 200)
        limit('physicalCells');
    }
    for (const row of sheet.rows) {
      if (row.length !== sheet.columns.length) mismatch();
      for (const cell of row) {
        if (cell.type === 'string' && typeof cell.value === 'string') {
          assertExcelText(cell.value);
          if (cell.value.length > 30000 || (cell.value.match(/\n/g)?.length ?? 0) > 200)
            limit('physicalCells');
        } else if (cell.type !== 'boolean' || typeof cell.value !== 'boolean') mismatch();
      }
    }
  }
  // Validate the observed manifest, versioned sheet map, markers, chunks and relations.
  if (model.projectionVersion === 1) reverseWorkbookModel(model);
  else if (model.projectionVersion === 2) reverseWorkbookModelV2(model);
  else if (model.projectionVersion === 3) reverseWorkbookModelV3(model);
  else if (model.projectionVersion === 4) reverseWorkbookModelV4(model);
  else if (model.projectionVersion === 5) reverseWorkbookModelV5(model);
  else reverseWorkbookModelV6(model);
}

async function writeWorkbookXlsx(
  model: AnyWorkbookModelV5 | WorkbookModelV6,
  projectionVersion: 1 | 2 | 3 | 4 | 5 | 6,
): Promise<Uint8Array> {
  try {
    checkModel(model, projectionVersion);
    const book = new ExcelJS.Workbook();
    book.creator = 'Work Tracker';
    book.lastModifiedBy = 'Work Tracker';
    book.created = new Date('2000-01-01T00:00:00.000Z');
    book.modified = new Date('2000-01-01T00:00:00.000Z');
    // ExcelJS supports shared style objects. These immutable-by-convention styles are
    // assigned once, rather than allocating two nested objects for every dense cell.
    const bodyStyle: Partial<ExcelJS.Style> = {
      alignment: { vertical: 'top', wrapText: true },
      numFmt: '@',
    };
    const headerStyle: Partial<ExcelJS.Style> = { ...bodyStyle, font: { bold: true } };
    for (const sheet of model.sheets) {
      const out = book.addWorksheet(sheet.name, {
        views: [{ state: 'frozen', ySplit: 1 }],
      });
      out.columns = sheet.columns.map((heading) => ({
        width:
          heading.endsWith('__isNull') || heading.endsWith('__isAbsent')
            ? 12
            : /text|body|content|before|after/i.test(heading)
              ? 48
              : 24,
      }));
      const header = out.addRow(sheet.columns.map(officeText));
      header.eachCell((cell) => {
        cell.style = headerStyle;
      });
      for (const row of sheet.rows) {
        const line = out.addRow(
          row.map((cell) => (cell.type === 'string' ? officeText(cell.value) : cell.value)),
        );
        line.eachCell((cell) => {
          cell.style = bodyStyle;
        });
      }
      if (sheet.autoFilter)
        out.autoFilter = {
          from: { row: 1, column: 1 },
          to: { row: sheet.rows.length + 1, column: sheet.columns.length },
        };
    }
    const bytes = new Uint8Array(await book.xlsx.writeBuffer());
    if (!bytes.byteLength) throw new ExportError('XLSX_BUILD_FAILED');
    if (bytes.byteLength > EXPORT_LIMITS.pairBytes) limit('pairBytes');
    return bytes;
  } catch (error) {
    if (error instanceof ExportError) throw error;
    throw new ExportError('XLSX_BUILD_FAILED');
  }
}

type ZipPart = { name: string; size: number; crc: number };
// JSZip documents internalStream, but 3.10.2 omits it from JSZipObject's declarations.
type ZipEntryStream = {
  on(event: 'data', handler: (chunk: Uint8Array) => void): ZipEntryStream;
  on(event: 'end', handler: () => void): ZipEntryStream;
  on(event: 'error', handler: (error: unknown) => void): ZipEntryStream;
  pause(): ZipEntryStream;
  resume(): ZipEntryStream;
};
/** Inspect bounded ZIP metadata before JSZip can inflate any member. ZIP64 is outside this format. */
function zipParts(bytes: Uint8Array): ZipPart[] {
  if (!bytes.byteLength || bytes.byteLength > EXPORT_LIMITS.pairBytes) limit('pairBytes');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (p: number) => view.getUint16(p, true),
    u32 = (p: number) => view.getUint32(p, true);
  let end = bytes.length - 22;
  const lower = Math.max(0, bytes.length - 65557);
  while (end >= lower && u32(end) !== 0x06054b50) end--;
  if (
    end < lower ||
    end + 22 + u16(end + 20) !== bytes.length ||
    u16(end + 4) ||
    u16(end + 6) ||
    u16(end + 8) !== u16(end + 10)
  )
    mismatch();
  const count = u16(end + 10),
    offset = u32(end + 16),
    length = u32(end + 12);
  if (count > MAX_PARTS || offset + length !== end) mismatch();
  const result: ZipPart[] = [],
    names = new Set<string>();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pos = offset,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || u32(pos) !== 0x02014b50) mismatch();
    const flags = u16(pos + 8),
      method = u16(pos + 10),
      crc = u32(pos + 16),
      compressed = u32(pos + 20),
      size = u32(pos + 24),
      nameLength = u16(pos + 28),
      next = pos + 46 + nameLength + u16(pos + 30) + u16(pos + 32),
      local = u32(pos + 42);
    if (next > end || flags & ~0x0808 || (method !== 0 && method !== 8) || u16(pos + 34))
      mismatch();
    if (compressed > EXPORT_LIMITS.pairBytes || size > MAX_XML_BYTES) limit('pairBytes');
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength));
    if (
      !/^[A-Za-z0-9_./[\]-]+$/.test(name) ||
      name.startsWith('/') ||
      name.split('/').some((s) => s === '.' || s === '..') ||
      names.has(name)
    )
      mismatch();
    names.add(name);
    if (
      local + 30 > offset ||
      u32(local) !== 0x04034b50 ||
      u16(local + 6) !== flags ||
      u16(local + 8) !== method ||
      u16(local + 26) !== nameLength ||
      local + 30 + nameLength + u16(local + 28) + compressed > offset ||
      decoder.decode(bytes.subarray(local + 30, local + 30 + nameLength)) !== name
    )
      mismatch();
    total += size;
    if (total > MAX_XML_BYTES) limit('pairBytes');
    if (!name.endsWith('/')) result.push({ name, size, crc });
    else if (size !== 0) mismatch();
    pos = next;
  }
  if (pos !== end) mismatch();
  return result;
}
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let n = i;
  for (let j = 0; j < 8; j++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
async function xmlPart(zip: JSZip, part: ZipPart): Promise<string> {
  const entry = zip.file(part.name);
  if (!entry) mismatch();
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0,
      crc = 0xffffffff,
      failed = false;
    const stream = (
      entry as unknown as {
        internalStream(type: 'uint8array'): ZipEntryStream;
      }
    ).internalStream('uint8array');
    stream.on('data', (chunk: Uint8Array) => {
      if (failed) return;
      size += chunk.byteLength;
      if (size > part.size || size > MAX_XML_BYTES) {
        failed = true;
        stream.pause();
        chunks.length = 0;
        reject(new ExportError('EXPORT_LIMIT_EXCEEDED', 'pairBytes'));
        return;
      }
      for (const b of chunk) crc = crcTable[(crc ^ b) & 255]! ^ (crc >>> 8);
      chunks.push(chunk);
    });
    stream.on('error', () => {
      failed = true;
      chunks.length = 0;
      reject(new ExportError('PAIR_MISMATCH'));
    });
    stream.on('end', () => {
      if (failed) return;
      if (size !== part.size || (crc ^ 0xffffffff) >>> 0 !== part.crc) {
        reject(new ExportError('PAIR_MISMATCH'));
        return;
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      try {
        resolve(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch {
        reject(new ExportError('PAIR_MISMATCH'));
      }
    });
    stream.resume();
  });
}
function attr(tag: SaxesTagNS, name: string, uri = ''): string | undefined {
  return Object.values(tag.attributes).find((a) => a.local === name && a.uri === uri)?.value;
}
type XmlHooks = {
  open?: (tag: SaxesTagNS, path: string[]) => void;
  text?: (text: string, path: string[]) => void;
  close?: (tag: SaxesTagNS, path: string[]) => void;
};
function parseXml(text: string, hooks: XmlHooks): void {
  const parser = new SaxesParser({ xmlns: true });
  const path: string[] = [];
  let roots = 0;
  parser.on('doctype', mismatch);
  parser.on('processinginstruction', mismatch);
  parser.on('cdata', mismatch);
  parser.on('error', mismatch);
  parser.on('opentag', (tag) => {
    if (!namespaces.has(tag.uri) || path.length > 32) mismatch();
    if (
      (parser.xmlDecl.version !== undefined && parser.xmlDecl.version !== '1.0') ||
      (parser.xmlDecl.encoding !== undefined && parser.xmlDecl.encoding.toLowerCase() !== 'utf-8')
    )
      mismatch();
    for (const a of Object.values(tag.attributes))
      if ((a.uri && !namespaces.has(a.uri)) || (a.uri === XMLNS && !namespaces.has(a.value)))
        mismatch();
    if (!path.length) roots++;
    // Formulae, hyperlinks and embedded/active content never belong to this projection.
    if (
      tag.uri === MAIN &&
      ['f', 'hyperlink', 'hyperlinks', 'oleObjects', 'oleObject', 'externalReferences'].includes(
        tag.local,
      )
    )
      mismatch();
    hooks.open?.(tag, path);
    path.push(tag.local);
  });
  parser.on('text', (value) => hooks.text?.(value, path));
  parser.on('closetag', (tag) => {
    hooks.close?.(tag, path);
    path.pop();
  });
  parser.write(text).close();
  if (roots !== 1 || path.length) mismatch();
}
type Relationship = { id: string; type: string; target: string };
function readRelationships(text: string, base: '' | 'xl/'): Relationship[] {
  const rows: Relationship[] = [],
    ids = new Set<string>();
  parseXml(text, {
    open(tag, path) {
      if (
        tag.uri !== PKG ||
        (path.length
          ? tag.local !== 'Relationship' || path.join('/') !== 'Relationships'
          : tag.local !== 'Relationships')
      )
        mismatch();
      if (tag.local === 'Relationship') {
        const id = attr(tag, 'Id'),
          type = attr(tag, 'Type'),
          target = attr(tag, 'Target');
        if (
          !id ||
          !type ||
          !target ||
          attr(tag, 'TargetMode') ||
          ids.has(id) ||
          !/^[A-Za-z0-9_./-]+$/.test(target) ||
          target.startsWith('/') ||
          target.split('/').some((s) => s === '.' || s === '..')
        )
          mismatch();
        ids.add(id);
        rows.push({ id, type, target: base + target });
      }
    },
  });
  return rows;
}
function readSharedStrings(text: string): string[] {
  const values: string[] = [];
  let content = '',
    textNodes = 0;
  parseXml(text, {
    open(tag, path) {
      if (
        tag.uri !== MAIN ||
        !['sst', 'si', 't'].includes(tag.local) ||
        (tag.local === 'sst'
          ? path.length !== 0
          : tag.local === 'si'
            ? path.join('/') !== 'sst'
            : path.join('/') !== 'sst/si')
      )
        mismatch();
      if (tag.local === 'si') {
        content = '';
        textNodes = 0;
      }
      if (tag.local === 't') textNodes++;
    },
    text(value, path) {
      if (path.join('/') === 'sst/si/t') content += value;
      else if (value.trim()) mismatch();
    },
    close(tag) {
      if (tag.local === 'si') {
        if (textNodes !== 1 || values.length >= EXPORT_LIMITS.physicalCells) mismatch();
        const value = readOfficeText(content);
        if (value.length > 30000 || (value.match(/\n/g)?.length ?? 0) > 200) mismatch();
        values.push(value);
      }
    },
  });
  return values;
}
function readStyles(text: string): boolean[] {
  const wraps: boolean[] = [];
  let current = -1;
  parseXml(text, {
    open(tag, path) {
      if (!path.length && (tag.uri !== MAIN || tag.local !== 'styleSheet')) mismatch();
      if (tag.uri === MAIN && tag.local === 'xf' && path.join('/') === 'styleSheet/cellXfs') {
        current = wraps.length;
        wraps.push(false);
        if (wraps.length > 4) mismatch();
      }
      if (
        tag.uri === MAIN &&
        tag.local === 'alignment' &&
        path.join('/') === 'styleSheet/cellXfs/xf'
      )
        wraps[current] = attr(tag, 'wrapText') === '1';
    },
    close(tag, path) {
      if (tag.local === 'xf' && path.join('/') === 'styleSheet/cellXfs/xf') current = -1;
    },
  });
  return wraps;
}
function integer(text: string | undefined): number {
  if (text === undefined || !/^(0|[1-9][0-9]*)$/.test(text)) mismatch();
  const n = Number(text);
  if (!Number.isSafeInteger(n)) mismatch();
  return n;
}
function readSheet(
  text: string,
  name: string,
  shared: string[],
  wraps: boolean[],
  charge: () => void,
): ExportSheet {
  const rows: ExportCell[][] = [];
  let row: ExportCell[] | undefined,
    cell: { type: string; value: string; count: number } | undefined;
  let panes = 0,
    views = 0,
    dataBlocks = 0,
    filter: string | undefined,
    dimension: string | undefined;
  const allowed = new Set([
    'worksheet',
    'dimension',
    'sheetViews',
    'sheetView',
    'pane',
    'selection',
    'sheetFormatPr',
    'cols',
    'col',
    'sheetData',
    'row',
    'c',
    'v',
    'autoFilter',
    'pageMargins',
    'pageSetup',
  ]);
  parseXml(text, {
    open(tag, path) {
      if (
        tag.uri !== MAIN ||
        !allowed.has(tag.local) ||
        (!path.length && tag.local !== 'worksheet')
      )
        mismatch();
      const parent = path.at(-1);
      const expectedParent =
        tag.local === 'worksheet'
          ? undefined
          : [
                'dimension',
                'sheetViews',
                'sheetFormatPr',
                'cols',
                'sheetData',
                'autoFilter',
                'pageMargins',
                'pageSetup',
              ].includes(tag.local)
            ? 'worksheet'
            : tag.local === 'sheetView'
              ? 'sheetViews'
              : tag.local === 'pane' || tag.local === 'selection'
                ? 'sheetView'
                : tag.local === 'col'
                  ? 'cols'
                  : tag.local === 'row'
                    ? 'sheetData'
                    : tag.local === 'c'
                      ? 'row'
                      : 'c';
      if (parent !== expectedParent) mismatch();
      if (tag.local === 'sheetData' && ++dataBlocks !== 1) mismatch();
      if (tag.local === 'dimension') {
        if (dimension !== undefined) mismatch();
        dimension = attr(tag, 'ref');
      }
      if (tag.local === 'sheetView') views++;
      if (tag.local === 'pane') {
        panes++;
        if (
          attr(tag, 'state') !== 'frozen' ||
          attr(tag, 'ySplit') !== '1' ||
          attr(tag, 'xSplit') ||
          attr(tag, 'topLeftCell') !== 'A2'
        )
          mismatch();
      }
      if (tag.local === 'autoFilter') {
        if (filter !== undefined) mismatch();
        filter = attr(tag, 'ref');
      }
      if (tag.local === 'row') {
        if (
          path.join('/') !== 'worksheet/sheetData' ||
          row ||
          integer(attr(tag, 'r')) !== rows.length + 1 ||
          rows.length >= 1048576
        )
          mismatch();
        row = [];
      }
      if (tag.local === 'c') {
        if (
          path.join('/') !== 'worksheet/sheetData/row' ||
          !row ||
          cell ||
          row.length >= 16384 ||
          attr(tag, 'r') !== columnName(row.length + 1) + String(rows.length + 1) ||
          !wraps[integer(attr(tag, 's'))]
        )
          mismatch();
        const type = attr(tag, 't');
        if (type !== 's' && type !== 'b') mismatch();
        charge();
        cell = { type, value: '', count: 0 };
      }
      if (tag.local === 'v') {
        if (path.join('/') !== 'worksheet/sheetData/row/c' || !cell) mismatch();
        cell.count++;
      }
    },
    text(value, path) {
      if (path.join('/') === 'worksheet/sheetData/row/c/v' && cell) cell.value += value;
      else if (value.trim()) mismatch();
    },
    close(tag) {
      if (tag.local === 'c') {
        if (!cell || !row || cell.count !== 1) mismatch();
        if (cell.type === 'b') {
          if (cell.value !== '0' && cell.value !== '1') mismatch();
          row.push({ type: 'boolean', value: cell.value === '1' });
        } else {
          const value = shared[integer(cell.value)];
          if (value === undefined) mismatch();
          row.push({ type: 'string', value });
        }
        cell = undefined;
      }
      if (tag.local === 'row') {
        if (!row || !row.length) mismatch();
        rows.push(row);
        row = undefined;
      }
    },
  });
  const header = rows.shift();
  if (
    !header?.length ||
    header.some((c) => c.type !== 'string') ||
    panes !== 1 ||
    views !== 1 ||
    dataBlocks !== 1 ||
    rows.some((r) => r.length !== header.length)
  )
    mismatch();
  const range = `A1:${columnName(header.length)}${rows.length + 1}`;
  if (dimension !== range || (filter !== undefined && filter !== range)) mismatch();
  return {
    name,
    columns: header.map((c) => String(c.value)),
    rows,
    freezeRows: 1,
    autoFilter: filter !== undefined,
    wrapText: true,
  };
}

/** Reads actual ZIP/XML cells without ExcelJS.load or any captured expected model. */
async function readWorkbookXlsx(bytes: Uint8Array, projectionVersion: 1 | 2 | 3 | 4 | 5 | 6) {
  try {
    const parts = zipParts(bytes),
      files = new Map<string, ZipPart>();
    const fixed = new Set([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/sharedStrings.xml',
      'xl/styles.xml',
      'xl/theme/theme1.xml',
      'docProps/core.xml',
      'docProps/app.xml',
    ]);
    for (const part of parts) {
      if (!fixed.has(part.name) && !/^xl\/worksheets\/sheet[1-9][0-9]*\.xml$/.test(part.name))
        mismatch();
      files.set(part.name, part);
    }
    if ([...fixed].some((name) => !files.has(name))) mismatch();
    const zip = await JSZip.loadAsync(bytes, { createFolders: false });
    const get = async (name: string) => {
      const part = files.get(name);
      if (!part) mismatch();
      return xmlPart(zip, part);
    };
    const rootRels = readRelationships(await get('_rels/.rels'), '');
    const rootExpected = new Map([
      [REL + '/officeDocument', 'xl/workbook.xml'],
      [
        'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
        'docProps/core.xml',
      ],
      [REL + '/extended-properties', 'docProps/app.xml'],
    ]);
    if (
      rootRels.length !== rootExpected.size ||
      new Set(rootRels.map((r) => r.type)).size !== rootExpected.size ||
      rootRels.some((r) => rootExpected.get(r.type) !== r.target)
    )
      mismatch();
    const rels = readRelationships(await get('xl/_rels/workbook.xml.rels'), 'xl/');
    const relMap = new Map(rels.map((r) => [r.id, r]));
    const auxiliary = new Map([
      [REL + '/styles', 'xl/styles.xml'],
      [REL + '/theme', 'xl/theme/theme1.xml'],
      [REL + '/sharedStrings', 'xl/sharedStrings.xml'],
    ]);
    for (const [type, target] of auxiliary)
      if (rels.filter((r) => r.type === type && r.target === target).length !== 1) mismatch();
    if (rels.some((r) => !auxiliary.has(r.type) && r.type !== REL + '/worksheet')) mismatch();
    const sheets: { name: string; target: string }[] = [],
      targets = new Set<string>();
    parseXml(await get('xl/workbook.xml'), {
      open(tag, path) {
        if (
          tag.uri !== MAIN ||
          ![
            'workbook',
            'fileVersion',
            'workbookPr',
            'sheets',
            'sheet',
            'calcPr',
            'bookViews',
            'workbookView',
          ].includes(tag.local)
        )
          mismatch();
        if (!path.length && tag.local !== 'workbook') mismatch();
        if (tag.local === 'sheet') {
          const name = attr(tag, 'name'),
            id = attr(tag, 'id', REL),
            r = id ? relMap.get(id) : undefined;
          if (
            path.join('/') !== 'workbook/sheets' ||
            !name ||
            !r ||
            r.type !== REL + '/worksheet' ||
            targets.has(r.target) ||
            !/^xl\/worksheets\/sheet[1-9][0-9]*\.xml$/.test(r.target) ||
            attr(tag, 'state') !== 'visible'
          )
            mismatch();
          targets.add(r.target);
          sheets.push({ name: readOfficeText(name), target: r.target });
        }
      },
    });
    if (
      !sheets.length ||
      sheets.length > 64 ||
      rels.length !== sheets.length + auxiliary.size ||
      parts.length !== fixed.size + sheets.length
    )
      mismatch();
    const contentParts = new Set<string>();
    parseXml(await get('[Content_Types].xml'), {
      open(tag, path) {
        if (
          tag.uri !== TYPES ||
          !['Types', 'Default', 'Override'].includes(tag.local) ||
          (!path.length ? tag.local !== 'Types' : path.join('/') !== 'Types')
        )
          mismatch();
        if (tag.local === 'Default') {
          const ext = attr(tag, 'Extension'),
            type = attr(tag, 'ContentType');
          if (
            !ext ||
            !type ||
            !new Map([
              ['rels', 'application/vnd.openxmlformats-package.relationships+xml'],
              ['xml', 'application/xml'],
              ['vml', 'application/vnd.openxmlformats-officedocument.vmlDrawing'],
            ]).has(ext) ||
            (ext === 'rels'
              ? type !== 'application/vnd.openxmlformats-package.relationships+xml'
              : ext === 'xml'
                ? type !== 'application/xml'
                : type !== 'application/vnd.openxmlformats-officedocument.vmlDrawing')
          )
            mismatch();
        }
        if (tag.local === 'Override') {
          const partName = attr(tag, 'PartName'),
            name = partName?.slice(1),
            type = attr(tag, 'ContentType');
          const expected =
            name === 'xl/workbook.xml'
              ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'
              : name && targets.has(name)
                ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'
                : name === 'xl/styles.xml'
                  ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml'
                  : name === 'xl/sharedStrings.xml'
                    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml'
                    : name === 'xl/theme/theme1.xml'
                      ? 'application/vnd.openxmlformats-officedocument.theme+xml'
                      : name === 'docProps/core.xml'
                        ? 'application/vnd.openxmlformats-package.core-properties+xml'
                        : name === 'docProps/app.xml'
                          ? 'application/vnd.openxmlformats-officedocument.extended-properties+xml'
                          : undefined;
          if (
            !partName?.startsWith('/') ||
            !name ||
            !expected ||
            type !== expected ||
            contentParts.has(name)
          )
            mismatch();
          contentParts.add(name);
        }
      },
    });
    if (contentParts.size !== sheets.length + 6) mismatch();
    // Even non-cell XML must be well formed, use permitted namespaces, and contain no active nodes.
    for (const name of ['xl/theme/theme1.xml', 'docProps/core.xml', 'docProps/app.xml'])
      parseXml(await get(name), {});
    const shared = readSharedStrings(await get('xl/sharedStrings.xml')),
      wraps = readStyles(await get('xl/styles.xml'));
    const observed: ExportSheet[] = [];
    let cells = 0;
    const charge = () => {
      if (++cells > EXPORT_LIMITS.physicalCells) limit('physicalCells');
    };
    for (const sheet of sheets)
      observed.push(readSheet(await get(sheet.target), sheet.name, shared, wraps, charge));
    const model: AnyWorkbookModelV5 | WorkbookModelV6 =
      projectionVersion === 1
        ? { projectionVersion: 1, sheets: observed }
        : projectionVersion === 2
          ? { projectionVersion: 2, sheets: observed }
          : projectionVersion === 3
            ? { projectionVersion: 3, sheets: observed }
            : projectionVersion === 4
              ? { projectionVersion: 4, sheets: observed }
              : projectionVersion === 5
                ? { projectionVersion: 5, sheets: observed }
                : { projectionVersion: 6, sheets: observed };
    checkModel(model, projectionVersion);
    return {
      model,
      formulaCount: 0,
      hyperlinkCount: 0,
      externalRelationshipCount: 0,
      macroCount: 0,
    };
  } catch (error) {
    if (error instanceof ExportError) throw error;
    throw new ExportError('PAIR_MISMATCH');
  }
}

/** Projection 1 remains explicit; old files are never converted to projection 2. */
export function writeExportWorkbookXlsx(model: WorkbookModel): Promise<Uint8Array> {
  return writeWorkbookXlsx(model, 1);
}
export async function readExportWorkbookXlsx(
  bytes: Uint8Array,
): ReturnType<ExportPairAdapter['read']> {
  const { model, ...counts } = await readWorkbookXlsx(bytes, 1);
  if (model.projectionVersion !== 1) mismatch();
  return { model, ...counts };
}
export function createXlsxExportAdapter(): ExportPairAdapter {
  return { write: writeExportWorkbookXlsx, read: readExportWorkbookXlsx };
}

export function writeExportWorkbookXlsxV2(model: WorkbookModelV2): Promise<Uint8Array> {
  return writeWorkbookXlsx(model, 2);
}
export async function readExportWorkbookXlsxV2(
  bytes: Uint8Array,
): ReturnType<ExportPairAdapterV2['read']> {
  const { model, ...counts } = await readWorkbookXlsx(bytes, 2);
  if (model.projectionVersion !== 2) mismatch();
  return { model, ...counts };
}
export function createXlsxExportAdapterV2(): ExportPairAdapterV2 {
  return { write: writeExportWorkbookXlsxV2, read: readExportWorkbookXlsxV2 };
}

export function writeExportWorkbookXlsxV3(model: WorkbookModelV3): Promise<Uint8Array> {
  return writeWorkbookXlsx(model, 3);
}
export async function readExportWorkbookXlsxV3(
  bytes: Uint8Array,
): ReturnType<ExportPairAdapterV3['read']> {
  const { model, ...counts } = await readWorkbookXlsx(bytes, 3);
  if (model.projectionVersion !== 3) mismatch();
  return { model, ...counts };
}
export function createXlsxExportAdapterV3(): ExportPairAdapterV3 {
  return { write: writeExportWorkbookXlsxV3, read: readExportWorkbookXlsxV3 };
}

export function writeExportWorkbookXlsxV4(model: WorkbookModelV4): Promise<Uint8Array> {
  return writeWorkbookXlsx(model, 4);
}
export async function readExportWorkbookXlsxV4(
  bytes: Uint8Array,
): ReturnType<ExportPairAdapterV4['read']> {
  const { model, ...counts } = await readWorkbookXlsx(bytes, 4);
  if (model.projectionVersion !== 4) mismatch();
  return { model, ...counts };
}
export function createXlsxExportAdapterV4(): ExportPairAdapterV4 {
  return { write: writeExportWorkbookXlsxV4, read: readExportWorkbookXlsxV4 };
}

export function writeExportWorkbookXlsxV5(model: WorkbookModelV5): Promise<Uint8Array> {
  return writeWorkbookXlsx(model, 5);
}
export async function readExportWorkbookXlsxV5(
  bytes: Uint8Array,
): ReturnType<ExportPairAdapterV5['read']> {
  const { model, ...counts } = await readWorkbookXlsx(bytes, 5);
  if (model.projectionVersion !== 5) mismatch();
  return { model, ...counts };
}
export function createXlsxExportAdapterV5(): ExportPairAdapterV5 {
  return { write: writeExportWorkbookXlsxV5, read: readExportWorkbookXlsxV5 };
}

export function createXlsxExportAdapterV6(): ExportPairAdapterV6 {
  return {
    write: (model) => writeWorkbookXlsx(model, 6),
    read: async (bytes) => {
      const { model, ...counts } = await readWorkbookXlsx(bytes, 6);
      if (model.projectionVersion !== 6) mismatch();
      return { model, ...counts };
    },
  };
}
