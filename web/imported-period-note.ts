/** Only the importer's exact trailing source marker is hidden; stored bytes remain intact. */
function parts(body: string) {
  const marker =
    /(?:\r?\n){2}\[원본: [^\r\n]+\.xlsx\s*\/\s*[^\r\n]+![A-Z]+\d+(?::[A-Z]+\d+)?\](?:\r?\n)?$/.exec(
      body,
    );
  return marker ? { notes: body.slice(0, marker.index), suffix: marker[0] } : null;
}
export function editablePeriodNote(body: string) {
  return parts(body)?.notes ?? body;
}
export function replacePeriodNote(body: string, notes: string) {
  const imported = parts(body);
  if (!imported) return notes;
  return notes === imported.notes ? body : notes + imported.suffix;
}
export function periodNoteCapacity(body: string) {
  return Math.max(0, 5000 - (parts(body)?.suffix.length ?? 0));
}
