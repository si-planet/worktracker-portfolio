/** Parse only the canonical imported prefix, never source-like prose elsewhere. */
function importedContentParts(content: string) {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  if (
    !/^원본: .+\.xlsx\s*\/\s*.+!\S+/.test(lines[0] ?? '') ||
    !/^구분: (.*?) \/ 우선순위: (.*)$/.test(lines[1] ?? '')
  )
    return null;
  const metadata = lines.slice(0, 2);
  const importedRemarks: string[] = [];
  let cursor = 2;
  for (;;) {
    const entry =
      /^(\d{1,2}\/\d{1,2}) \[[A-Z]+\d+\] (미완료\/예정|완료|진행 중|미진행)(?: · (.*))?$/.exec(
        lines[cursor] ?? '',
      );
    if (!entry) break;
    metadata.push(lines[cursor]!);
    if (entry[3]) importedRemarks.push(`${entry[1]} · ${entry[3]}`);
    cursor++;
  }
  if (
    cursor > 2 &&
    /^\d{1,2}\/\d{1,2}은 원본에 등록된 예정 내용이며 수행 완료로 판단하지 않음\.$/.test(
      lines[cursor] ?? '',
    )
  ) {
    metadata.push(lines[cursor]!);
    cursor++;
  }
  // One paragraph boundary separates preserved bookkeeping from editable prose.
  // It is added only when remarks are explicitly edited, never on read/title edits.
  const explicitNotes = lines[cursor] === '';
  if (explicitNotes) cursor++;
  const notes = [...(explicitNotes ? [] : importedRemarks), ...lines.slice(cursor)].join(newline);
  return { metadata, notes, newline, embeddedRemarks: importedRemarks.length > 0 };
}
export function dailySheetDetails(content: string | null, mustFinishToday = false) {
  const text = content ?? '',
    parts = importedContentParts(text);
  const classification = parts ? /^구분: (.*?) \/ 우선순위: (.*)$/.exec(parts.metadata[1]!) : null;
  return {
    category: classification?.[1] ?? '',
    priority: mustFinishToday ? '당일 필수' : (classification?.[2] ?? '').trim(),
    notes: parts?.notes.trim() ?? text,
    imported: !!parts,
  };
}
export function editableDailyNotes(content: string) {
  return importedContentParts(content)?.notes ?? content;
}
export function replaceDailyNotes(content: string, notes: string) {
  const parts = importedContentParts(content);
  if (!parts) return notes;
  if (notes === parts.notes) return content;
  return (
    parts.metadata.join(parts.newline) +
    (notes || parts.embeddedRemarks ? parts.newline + parts.newline + notes : '')
  );
}
export function importedImportance(content: string | null) {
  const priority = dailySheetDetails(content).priority.trim();
  return priority !== '' && !/^(?:[-–—]|없음|일반|0)$/.test(priority);
}
export function dailyNoteCapacity(content: string) {
  const parts = importedContentParts(content);
  return parts
    ? Math.max(0, 5000 - parts.metadata.join(parts.newline).length - 2 * parts.newline.length)
    : 5000;
}
export function editableDailyNotesFrom(baseline: string | null, current: string) {
  return importedContentParts(baseline ?? '') ? editableDailyNotes(current) : current;
}
