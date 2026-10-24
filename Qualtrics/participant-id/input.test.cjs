const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/Q.js', 'utf8');

function setup({ legacy = false, fail = false, previous = '' } = {}) {
  const values = {}; const listeners = {}; const callbacks = {}; const logs = [];
  const input = { value: '', setAttribute() {}, addEventListener(n, f) { listeners[n] = f; }, removeEventListener() {} };
  const error = {};
  const root = { classList: { add() {} }, querySelector(s) { return s === '.pd-study-id-input' ? input : error; } };
  const q = { enabled: false, getQuestionContainer: () => root, disableNextButton() { this.enabled = false; }, enableNextButton() { this.enabled = true; } };
  const se = {
    addOnReady(f) { callbacks.ready = f; }, addOnPageSubmit(f) { callbacks.submit = f; }, addOnUnload() {},
    setEmbeddedData(k, v) { values[k] = v; }, getEmbeddedData() { return previous; },
  };
  if (!legacy) {
    se.setJSEmbeddedData = (k, v) => { if (fail) throw Error('failed'); values[k] = v; };
    se.getJSEmbeddedData = () => previous;
  }
  vm.runInNewContext(source, { Qualtrics: { SurveyEngine: se }, document: { readyState: 'complete' }, console: { log(line) { logs.push(JSON.parse(line.slice('[PD-ID] '.length))); } } });
  callbacks.ready.call(q);
  return { values, input, error, q, callbacks, logs, type(value) { input.value = value; listeners.input(); } };
}
test('custom input saves normalized IDs, clears erased IDs and blocks control characters', () => {
  const s = setup();
  assert.equal(s.q.enabled, false);
  s.type(' 001 ');
  assert.equal(s.values.pd_study_id, '001');
  assert.equal(s.q.enabled, true);
  s.type('   ');
  assert.equal(s.values.pd_study_id, '');
  assert.equal(s.q.enabled, false);
  s.type('A\tB');
  assert.equal(s.q.enabled, false);
});
test('restore and page-submit save, legacy API fallback, save failure', () => {
  const s = setup({ previous: 'TEST001' });
  assert.equal(s.input.value, 'TEST001');
  s.input.value = 'TEST002';
  s.callbacks.submit();
  assert.equal(s.values.pd_study_id, 'TEST002');
  const saved = s.logs.find(row => row.stage === 'input.saved' && row.extra.writtenValue === 'TEST002');
  assert.equal(saved.jsId.value, 'TEST001'); // mock getter stays constant, revealing read/write mismatches
  assert.ok(s.logs.some(row => row.stage === 'input.submit.after'));
  const old = setup({ legacy: true });
  old.type('003');
  assert.equal(old.values.__js_pd_study_id, '003');
  assert.equal(old.values.pd_study_id, '003');
  const failed = setup({ fail: true });
  failed.type('004');
  assert.equal(failed.q.enabled, false);
  assert.match(failed.error.textContent, /保存できません/);
});
test('game reads JS embedded ID before legacy field, and supports legacy-only surveys', () => {
  const game = fs.readFileSync(__dirname + '/../current/Q.js', 'utf8');
  const snippet = game.slice(game.indexOf('  var studyId = '), game.indexOf('  if (!studyId) {'));
  function read(value) {
    const context = { Qualtrics: { SurveyEngine: { getJSEmbeddedData: () => value } }, pdIdDebug() {}, pdIsUnresolvedPipedText: v => v.startsWith('${') };
    vm.runInNewContext(snippet, context);
    return context.studyId;
  }
  assert.equal(read(' 001 '), '001');
  assert.equal(read(''), '');
  const context = { Qualtrics: { SurveyEngine: {} }, pdIdDebug() {}, pdIsUnresolvedPipedText: () => false };
  vm.runInNewContext(snippet.replace('${e://Field/pd_study_id}', 'LEGACY001'), context);
  assert.equal(context.studyId, 'LEGACY001');
});
