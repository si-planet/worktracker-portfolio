import ExcelJS from 'exceljs';
import JSZip from 'jszip';

export const WBS_EXCEL_LIMITS = {
  fileBytes: 8 * 1024 * 1024,
  expandedBytes: 32 * 1024 * 1024,
  rows: 200,
} as const;
export type WbsExcelRow = {
  sourceRow: number;
  code: string;
  title: string;
  description: string;
  plannedStartOn: string | null;
  plannedEndOn: string | null;
  sortOrder: number;
};
export type WbsExcelPreview = {
  sheetName: string;
  rows: WbsExcelRow[];
  warnings: string[];
  errors: string[];
};

// Stream and discard expanded bytes before ExcelJS builds any XML workbook model.
async function checkActualExpansion(buffer: ArrayBuffer) {
  const zip = await JSZip.loadAsync(buffer);
  let total = 0;
  for (const file of Object.values(zip.files)) {
    if (file.dir) continue;
    await new Promise<void>((resolve, reject) => {
      // JSZip 3.x exposes this runtime API but omits it from JSZipObject typings.
      const stream = (
        file as typeof file & {
          internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>;
        }
      ).internalStream('uint8array');
      stream
        .on('data', (chunk) => {
          total += chunk.byteLength;
          if (total > WBS_EXCEL_LIMITS.expandedBytes) {
            stream.pause();
            reject(new Error('XLSX 압축 해제 크기는 32MB 이하여야 합니다.'));
          }
        })
        .on('error', reject)
        .on('end', resolve)
        .resume();
    });
  }
}

// Check declared ZIP expansion before ExcelJS decompresses the workbook.
function checkZip(buffer: ArrayBuffer) {
  const v = new DataView(buffer);
  let eocd = -1;
  for (let i = v.byteLength - 22; i >= Math.max(0, v.byteLength - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('올바른 XLSX 파일이 아닙니다.');
  const count = v.getUint16(eocd + 10, true);
  let offset = v.getUint32(eocd + 16, true),
    expanded = 0;
  if (
    count > 512 ||
    count === 0 ||
    v.getUint16(eocd + 4, true) !== 0 ||
    v.getUint16(eocd + 6, true) !== 0
  )
    throw new Error('지원 범위를 벗어난 XLSX 압축 형식입니다.');
  for (let i = 0; i < count; i++) {
    if (offset + 46 > eocd || v.getUint32(offset, true) !== 0x02014b50)
      throw new Error('손상된 XLSX 압축 목록입니다.');
    expanded += v.getUint32(offset + 24, true);
    if (expanded > WBS_EXCEL_LIMITS.expandedBytes)
      throw new Error('압축 해제 크기는 32MB 이하여야 합니다.');
    offset +=
      46 +
      v.getUint16(offset + 28, true) +
      v.getUint16(offset + 30, true) +
      v.getUint16(offset + 32, true);
  }
}
const clean = (v: string) =>
  v
    .trim()
    .replace(/^[-–]\s*/, '')
    .trim();
function text(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v).trim();
  if (typeof v === 'object' && 'richText' in v)
    return v.richText
      .map((r) => r.text)
      .join('')
      .trim();
  if (typeof v === 'object' && 'text' in v) return String(v.text).trim();
  return '';
}
function formula(cell: ExcelJS.Cell) {
  return (
    cell.value !== null &&
    typeof cell.value === 'object' &&
    ('formula' in cell.value || 'sharedFormula' in cell.value)
  );
}
function isoDate(value: ExcelJS.CellValue, date1904: boolean): string | null {
  if (value == null || value === '') return null;
  let d: Date;
  if (value instanceof Date) d = value;
  else if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || (!date1904 && value === 60))
      throw new Error('정수 Excel 날짜 또는 YYYY-MM-DD 날짜를 입력하세요.');
    const epoch = Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30);
    d = new Date(epoch + (value + (!date1904 && value < 60 ? 1 : 0)) * 86400000);
  } else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    d = new Date(value.trim() + 'T00:00:00.000Z');
    if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value.trim())
      throw new Error('존재하지 않는 날짜입니다.');
  } else throw new Error('날짜는 Excel 날짜 또는 YYYY-MM-DD 형식이어야 합니다.');
  if (
    !Number.isFinite(d.getTime()) ||
    d.getUTCFullYear() < 1 ||
    d.getUTCFullYear() > 9999 ||
    d.getUTCHours() ||
    d.getUTCMinutes() ||
    d.getUTCSeconds() ||
    d.getUTCMilliseconds()
  )
    throw new Error('유효한 날짜만 입력하세요. 시간 값은 지원하지 않습니다.');
  return d.toISOString().slice(0, 10);
}

export async function parseWbsExcel(buffer: ArrayBuffer, year: number): Promise<WbsExcelPreview> {
  const result: WbsExcelPreview = { sheetName: '', rows: [], warnings: [], errors: [] };
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    result.errors.push('계획 연도를 확인하세요.');
    return result;
  }
  if (!buffer.byteLength || buffer.byteLength > WBS_EXCEL_LIMITS.fileBytes) {
    result.errors.push('XLSX 파일 크기는 8MB 이하여야 합니다.');
    return result;
  }
  try {
    checkZip(buffer);
    await checkActualExpansion(buffer);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer);
    const sheet = book.worksheets[0];
    if (!sheet) throw new Error('첫 번째 시트가 없습니다.');
    result.sheetName = sheet.name;
    const header = Array.from({ length: Math.min(sheet.rowCount, 20) }, (_, i) => i + 1).find(
      (r) =>
        text(sheet.getCell(r, 3)).replace(/\s/g, '') === '기능번호' &&
        text(sheet.getCell(r, 4)).replace(/\s/g, '') === '기능' &&
        text(sheet.getCell(r, 7)).replace(/\s/g, '') === '시작일' &&
        text(sheet.getCell(r, 8)).replace(/\s/g, '') === '종료일',
    );
    if (!header)
      throw new Error('첫 탭의 C~H 열에서 기능번호·기능·시작일·종료일 머리글을 찾지 못했습니다.');
    const label = (column: number) => text(sheet.getCell(header, column)).replace(/\s/g, '');
    if (
      !['구분', '분류'].includes(label(1)) ||
      label(2) !== '항목' ||
      !['세부설명', '설명'].includes(label(5)) ||
      label(6) !== '비고'
    )
      throw new Error(
        'A~H 열 순서는 구분·항목·기능번호·기능·세부 설명·비고·시작일·종료일이어야 합니다.',
      );
    if (sheet.rowCount > 5000)
      throw new Error('첫 탭의 행 범위가 너무 큽니다. 불필요한 빈 행 서식을 정리하세요.');
    const codes = new Set<string>();
    for (let r = header + 1; r <= sheet.rowCount; r++) {
      if (sheet.getCell(r, 3).isMerged && Number(sheet.getCell(r, 3).master.row) === header)
        continue;
      const cells = Array.from({ length: 8 }, (_, c) => sheet.getCell(r, c + 1));
      if (cells.slice(2).every((c) => c.value == null || c.value === '')) continue;
      if (result.rows.length >= WBS_EXCEL_LIMITS.rows) {
        result.errors.push('한 번에 등록할 수 있는 WBS 항목은 200개입니다.');
        break;
      }
      if (cells.some(formula)) {
        result.errors.push(
          `${r}행: 수식 셀은 지원하지 않습니다. 계산 결과를 값으로 붙여넣은 파일을 사용하세요.`,
        );
        continue;
      }
      const code = text(cells[2]!),
        name = clean(text(cells[3]!));
      if (code.length > 80) {
        result.errors.push(`${r}행: 기능번호는 80자 이하여야 합니다.`);
        continue;
      }
      if (!code || !name) {
        result.errors.push(`${r}행: 기능번호와 기능명이 모두 필요합니다.`);
        continue;
      }
      if (codes.has(code.normalize('NFKC').toLowerCase())) {
        result.errors.push(`${r}행: 기능번호 ${code}가 중복됩니다.`);
        continue;
      }
      codes.add(code.normalize('NFKC').toLowerCase());
      const title = `${code} ${name}`;
      const classification = [text(cells[0]!).replace(/\s*\n\s*/g, ' '), text(cells[1]!)]
        .filter(Boolean)
        .join(' · ');
      const description = [
        classification,
        clean(text(cells[4]!)),
        text(cells[5]!) ? `비고: ${text(cells[5]!)}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      if (title.length > 200 || description.length > 5000) {
        result.errors.push(`${r}행: 제목은 200자, 설명은 5,000자 이하여야 합니다.`);
        continue;
      }
      try {
        const start = isoDate(cells[6]!.value, !!book.properties.date1904),
          end = isoDate(cells[7]!.value, !!book.properties.date1904);
        if (start && end && start > end) throw new Error('종료일이 시작일보다 빠릅니다.');
        if ([start, end].some((d) => d && Number(d.slice(0, 4)) !== year))
          result.warnings.push(
            `${r}행: 계획 연도 ${year}와 다른 연도의 일정입니다. 원문 날짜를 유지합니다.`,
          );
        result.rows.push({
          sourceRow: r,
          code,
          title,
          description,
          plannedStartOn: start,
          plannedEndOn: end,
          sortOrder: result.rows.length,
        });
      } catch (e) {
        result.errors.push(`${r}행: ${e instanceof Error ? e.message : '날짜를 확인하세요.'}`);
      }
    }
    const timelineYears = new Set<number>();
    for (let r = header; r <= Math.min(header + 1, sheet.rowCount); r++) {
      for (let c = 9; c <= Math.min(sheet.columnCount, 100); c++) {
        const value = sheet.getCell(r, c).value;
        if (value instanceof Date || (typeof value === 'number' && value > 20000)) {
          try {
            const date = isoDate(value, !!book.properties.date1904);
            if (date) timelineYears.add(Number(date.slice(0, 4)));
          } catch {
            /* Decorative calendar cells do not supply item schedules. */
          }
        }
      }
    }
    if ([...timelineYears].some((y) => y !== year))
      result.warnings.push(
        `월·주차 표시 영역의 연도(${[...timelineYears].sort().join(', ')})가 계획 연도 ${year}와 다릅니다. 항목의 G/H 시작·종료일만 등록합니다.`,
      );
    if (!result.rows.length && !result.errors.length)
      result.errors.push('등록할 WBS 항목이 없습니다.');
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : 'XLSX 파일을 읽지 못했습니다.');
  }
  return result;
}
