// src/lib/csv.ts
/**
 * RFC-4180-ish CSV tokenizer: quoted fields, doubled-quote escaping, embedded
 * commas inside quotes, CRLF/CR/LF line endings, leading BOM stripped.
 * Shared by the roster importer and the time-sheet importer.
 */
export function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAnyContentInRow = false;

  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let i = 0;
  const len = src.length;

  while (i < len) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      sawAnyContentInRow = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      sawAnyContentInRow = true;
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      records.push(row);
      row = [];
      field = "";
      sawAnyContentInRow = false;
      i++;
      continue;
    }
    field += c;
    sawAnyContentInRow = true;
    i++;
  }

  if (sawAnyContentInRow || field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }

  return records;
}
