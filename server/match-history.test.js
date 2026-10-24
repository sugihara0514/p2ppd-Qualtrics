import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { MatchHistory, parseCsv, normalizeStudyId } from './match-history.js';

function setup(t, history) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-history-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const options = {};
  if (history !== undefined) {
    options.historyFile = path.join(dir, 'history.csv');
    fs.writeFileSync(options.historyFile, history);
  }
  return { options, dir };
}
test('no history requires no session and creates no files', t => {
  const { options, dir } = setup(t);
  const h = new MatchHistory(options);
  assert.equal(h.has('001', '002'), false);
  assert.equal(h.has('001', '001'), true);
  assert.equal(new MatchHistory().has('001', '002'), false);
  assert.deepEqual(fs.readdirSync(dir), []);
});
test('read-only CSV, reverse pair, leading zeros and quoted IDs', t => {
  const csv = '\uFEFFparticipant_id_1,participant_id_2\r\n001,"A,""B"\r\n';
  const { options } = setup(t, csv);
  const h = new MatchHistory(options);
  assert.equal(h.has('A,"B', '001'), true);
  assert.equal(h.has('A,"B', '1'), false);
  assert.equal(h.has('003', '004'), false);
  assert.equal(fs.readFileSync(options.historyFile, 'utf8'), csv);
});
test('missing file, corrupt data and blank IDs fail closed', t => {
  const { options } = setup(t, 'participant_id_1,participant_id_2\nA,A\n');
  assert.throws(() => new MatchHistory(options), /self_pair/);
  fs.writeFileSync(options.historyFile, 'bad,header\n');
  assert.throws(() => new MatchHistory(options), /missing_history/);
  fs.unlinkSync(options.historyFile);
  assert.throws(() => new MatchHistory(options), /ENOENT/);
  assert.throws(() => normalizeStudyId('  '));
  assert.throws(() => normalizeStudyId(123));
  assert.throws(() => parseCsv('a,"unterminated'));
  assert.equal(normalizeStudyId(' 001 '), '001');
});
test('server: exclude CSV pairs, preserve queue, resume, reject active duplicates, allow repeated tests', t => {
  const csv = 'participant_id_1,participant_id_2\nA,B\n';
  const { options, dir } = setup(t, csv);
  const history = new MatchHistory(options);
  const routes = new Map(); let sequence = 0;
  const source = fs.readFileSync(new URL('./server.js', import.meta.url), 'utf8');
  const context = vm.createContext({
    matchHistory: history, normalizeStudyId, uuid: () => String(++sequence),
    app: { post: (url, fn) => routes.set(url, fn), get: (url, fn) => routes.set(url, fn) },
    Date, console,
  });
  vm.runInContext(source.slice(source.indexOf('const WAIT_TTL_MS'), source.indexOf('app.post("/heartbeat"')), context);
  function request(route, body) {
    let code = 200; let result;
    const res = { status(n) { code = n; return this; }, json(data) { result = data; return this; } };
    routes.get(route)({ body, query: body }, res);
    return { code, ...result };
  }
  const join = (id, studyId, resumeToken) => request('/join', { participantId: id, studyId, resumeToken });
  const a = join('response-a', 'A');
  assert.equal(a.status, 'waiting');
  const b = join('response-b', 'B');
  assert.equal(b.status, 'waiting');
  assert.equal(join('duplicate-a', 'A').error, 'study_id_already_active');
  const c = join('response-c', 'C');
  assert.equal(c.status, 'paired');
  assert.equal(join('response-a', 'A', a.resumeToken).channel, c.channel);
  assert.equal(join('response-a', 'OTHER', a.resumeToken).error, 'study_id_mismatch');
  const d = join('response-d', 'D');
  assert.equal(d.status, 'paired');
  assert.equal(request('/match', { participantId: 'response-b', resumeToken: b.resumeToken }).channel, d.channel);
  assert.equal(history.has('A', 'C'), false);
  // Simulate finished sessions; only the supplied CSV controls later exclusion.
  vm.runInContext('for (const p of participants.values()) { p.finalLeft = true; p.channel = null; } rooms.clear();', context);
  assert.equal(join('new-response-a', 'A').status, 'waiting');
  const again = join('new-response-c', 'C');
  assert.equal(again.status, 'paired');
  assert.notEqual(again.channel, c.channel);
  assert.deepEqual(fs.readdirSync(dir), ['history.csv']);
  assert.equal(fs.readFileSync(options.historyFile, 'utf8'), csv);
});
