import fs from 'node:fs';

export function normalizeStudyId(value) {
  if (typeof value !== 'string' || !value.trim() || /[\r\n\x00-\x1f]/.test(value)) {
    throw new Error('invalid_study_id');
  }
  return value.trim();
}

// Strict CSV parser: supports quoted commas, double quotes and UTF-8 BOM.
export function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false; let closed = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else cell += c;
    } else if (c === ',' || c === '\n' || c === '\r') {
      row.push(cell); cell = ''; closed = false;
      if (c !== ',') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        if (row.some(v => v !== '')) rows.push(row);
        row = [];
      }
    } else if (c === '"' && cell === '' && !closed) quoted = true;
    else { if (closed || c === '"') throw new Error('invalid_history_csv'); cell += c; }
  }
  if (quoted) throw new Error('invalid_history_csv');
  row.push(cell);
  if (row.some(v => v !== '')) rows.push(row);
  return rows;
}

const key = (a, b) => JSON.stringify([a, b].sort());
export class MatchHistory {
  constructor({ historyFile } = {}) {
    this.pairs = new Set();
    if (historyFile) {
      const rows = parseCsv(fs.readFileSync(historyFile, 'utf8'));
      const header = rows.shift();
      if (!header || header.length !== new Set(header).size) throw new Error('invalid_history_header');
      const a = header.indexOf('participant_id_1'), b = header.indexOf('participant_id_2');
      if (a < 0 || b < 0) throw new Error('missing_history_columns');
      for (const row of rows) {
        if (row.length !== header.length) throw new Error('invalid_history_row');
        const left = normalizeStudyId(row[a]), right = normalizeStudyId(row[b]);
        if (left === right) throw new Error('self_pair_in_history');
        this.pairs.add(key(left, right));
      }
    }
  }
  has(a, b) { return a === b || this.pairs.has(key(a, b)); }
}
