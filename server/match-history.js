import fs from 'node:fs';
import path from 'node:path';

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
  constructor({ historyFile, journalFile, sessionId }) {
    if (!sessionId?.trim()) throw new Error('EXPERIMENT_SESSION_ID is required (e.g. day01)');
    this.sessionId = sessionId;
    this.journalFile = journalFile;
    this.pairs = new Set();
    this.records = [];
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
    fs.mkdirSync(path.dirname(journalFile), { recursive: true });
    if (fs.existsSync(journalFile)) {
      for (const line of fs.readFileSync(journalFile, 'utf8').split('\n').filter(Boolean)) {
        const record = JSON.parse(line);
        const a = normalizeStudyId(record.participant_id_1), b = normalizeStudyId(record.participant_id_2);
        if (a === b || !record.channel || !record.session_id || !record.matched_at) throw new Error('invalid_match_journal');
        this.pairs.add(key(a, b));
        this.records.push(record);
      }
    }
    // Fail startup if the journal cannot be opened for durable writes.
    fs.closeSync(fs.openSync(journalFile, 'a'));
  }
  has(a, b) { return a === b || this.pairs.has(key(a, b)); }
  usedThisSession(id) {
    return this.records.some(r => r.session_id === this.sessionId &&
      (r.participant_id_1 === id || r.participant_id_2 === id));
  }
  record(a, b, channel) {
    if (this.has(a, b)) throw new Error('pair_already_matched');
    const record = { participant_id_1: a, participant_id_2: b, channel,
      session_id: this.sessionId, matched_at: new Date().toISOString() };
    const fd = fs.openSync(this.journalFile, 'a');
    try { fs.writeFileSync(fd, JSON.stringify(record) + '\n'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    this.records.push(record);
    this.pairs.add(key(a, b));
    return record;
  }
}

export function recordsToCsv(records) {
  const columns = ['participant_id_1', 'participant_id_2', 'session_id', 'channel', 'matched_at'];
  const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
  return '\uFEFF' + columns.join(',') + '\r\n' + records.map(r => columns.map(c => quote(r[c])).join(',')).join('\r\n') + '\r\n';
}
