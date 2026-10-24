import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { MatchHistory, parseCsv, recordsToCsv, normalizeStudyId } from './match-history.js';

function setup(t, history) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-history-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const options = { journalFile: path.join(dir, 'matches.jsonl'), sessionId: 'day01' };
  if (history !== undefined) {
    options.historyFile = path.join(dir, 'history.csv');
    fs.writeFileSync(options.historyFile, history);
  }
  return options;
}
test('first day, symmetric exclusion, durable record and daily participation', t => {
  const opts = setup(t);
  const h = new MatchHistory(opts);
  assert.equal(h.has('001', '002'), false);
  h.record('001', '002', 'room-1');
  assert.equal(h.has('002', '001'), true);
  assert.throws(() => h.record('002', '001', 'room-2'));
  const restarted = new MatchHistory(opts);
  assert.equal(restarted.usedThisSession('001'), true);
  assert.equal(restarted.records.length, 1);
  const nextDay = new MatchHistory({ ...opts, sessionId: 'day02' });
  assert.equal(nextDay.usedThisSession('001'), false);
  assert.equal(nextDay.has('001', '002'), true);
});
test('CSV import, reverse pair, leading zeros, quoted IDs and export roundtrip', t => {
  const opts = setup(t, '\uFEFFparticipant_id_1,participant_id_2\r\n001,"A,""B"\r\n');
  const h = new MatchHistory(opts);
  assert.equal(h.has('A,"B', '001'), true);
  assert.equal(h.has('A,"B', '1'), false);
  h.record('003', '004', 'room-new');
  const csv = recordsToCsv(h.records);
  assert.equal(parseCsv(csv)[1][0], '003');
  fs.writeFileSync(opts.historyFile, csv);
  assert.equal(new MatchHistory(opts).has('004', '003'), true);
});
test('missing file, corrupt data, missing session and blank IDs fail closed', t => {
  const opts = setup(t, 'participant_id_1,participant_id_2\nA,A\n');
  assert.throws(() => new MatchHistory(opts), /self_pair/);
  fs.writeFileSync(opts.historyFile, 'bad,header\n');
  assert.throws(() => new MatchHistory(opts), /missing_history/);
  fs.unlinkSync(opts.historyFile);
  assert.throws(() => new MatchHistory(opts), /ENOENT/);
  assert.throws(() => new MatchHistory({ ...opts, sessionId: '' }));
  assert.throws(() => normalizeStudyId('  '));
  assert.throws(() => normalizeStudyId(123));
  assert.throws(() => parseCsv('a,"unterminated'));
  assert.equal(normalizeStudyId(' 001 '), '001');
});

test('actual server handlers: skip old opponents, preserve queue, resume and reject duplicates', t => {
  const opts = setup(t, 'participant_id_1,participant_id_2\nA,B\n');
  const history = new MatchHistory(opts);
  const routes = new Map(); let sequence = 0;
  const source = fs.readFileSync(new URL('./server.js', import.meta.url), 'utf8');
  const start = source.indexOf('const WAIT_TTL_MS');
  const end = source.indexOf('app.post("/heartbeat"');
  const context = vm.createContext({
    matchHistory: history, normalizeStudyId, uuid: () => String(++sequence),
    app: { post: (url, fn) => routes.set(url, fn), get: (url, fn) => routes.set(url, fn) },
    Date, console,
  });
  vm.runInContext(source.slice(start, end), context);
  function request(route, body) {
    let status = 200; let result;
    const res = { status(n) { status = n; return this; }, json(data) { result = data; return this; } };
    routes.get(route)({ body, query: body }, res);
    return { status, ...result };
  }
  const join = (id, studyId, resumeToken) => request('/join', { participantId: id, studyId, resumeToken });
  const a = join('response-a', 'A');
  assert.equal(a.status, 'waiting');
  const b = join('response-b', 'B');
  assert.equal(b.status, 'waiting');
  assert.equal(join('duplicate-a', 'A').error, 'study_id_already_active');
  const c = join('response-c', 'C');
  assert.equal(c.status, 'paired');
  const resumed = join('response-a', 'A', a.resumeToken);
  assert.equal(resumed.channel, c.channel);
  assert.equal(history.records.length, 1);
  assert.equal(join('response-a', 'OTHER', a.resumeToken).error, 'study_id_mismatch');
  const d = join('response-d', 'D');
  assert.equal(d.status, 'paired');
  const polled = request('/match', { participantId: 'response-b', resumeToken: b.resumeToken });
  assert.equal(polled.channel, d.channel);
  assert.equal(history.records.length, 2);
  // A new response after the original room is gone cannot obtain a second daily match.
  vm.runInContext('participants.get("response-a").finalLeft = true', context);
  assert.equal(join('new-response-a', 'A').error, 'already_matched_this_session');
  // Write failure must not publish a room or discard the older waiting player.
  const e = join('response-e', 'E');
  const originalRecord = history.record;
  history.record = () => { throw new Error('disk_unavailable'); };
  assert.throws(() => join('response-f', 'F'), /disk_unavailable/);
  history.record = originalRecord;
  const retried = request('/match', { participantId: 'response-f', resumeToken: vm.runInContext('participants.get("response-f").resumeToken', context) });
  assert.equal(retried.status, 'paired');
  assert.equal(request('/match', { participantId: 'response-e', resumeToken: e.resumeToken }).channel, retried.channel);
});
