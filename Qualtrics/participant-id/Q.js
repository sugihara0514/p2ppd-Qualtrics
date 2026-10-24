// Attach to a Text / Graphic (descriptive) question containing Q.html.
Qualtrics.SurveyEngine.addOnReady(function () {
  var version = '2026-10-24-id-debug-v1';
  var q = this;
  var se = Qualtrics.SurveyEngine;
  var root = q.getQuestionContainer();
  root.classList.add('pd-id-question');
  var input = root.querySelector('.pd-study-id-input');
  var error = root.querySelector('.pd-id-error');
  function inspect(method, key) {
    if (typeof se[method] !== 'function') return { available: false };
    try {
      var value = se[method](key);
      return { available: true, type: typeof value, value: value === undefined ? null : value };
    } catch (e) { return { available: true, error: String(e) }; }
  }
  function debug(stage, extra) {
    console.log('[PD-ID] ' + JSON.stringify({
      stage: stage, at: new Date().toISOString(), version: version,
      questionId: q.questionId || null, readyState: document.readyState,
      responseId: '${e://Field/ResponseID}',
      inputFound: !!input, inputValue: input ? input.value : null,
      jsId: inspect('getJSEmbeddedData', 'pd_study_id'),
      regularId: inspect('getEmbeddedData', 'pd_study_id'),
      prefixedId: inspect('getEmbeddedData', '__js_pd_study_id'),
      setJSAvailable: typeof se.setJSEmbeddedData === 'function',
      setLegacyAvailable: typeof se.setEmbeddedData === 'function',
      extra: extra || null
    }));
  }
  debug('input.ready');
  function showError(message) {
    if (error) { error.hidden = !message; error.textContent = message; }
  }
  if (!input) {
    debug('input.missing_element');
    q.disableNextButton();
    showError('入力欄がありません。ID入力設問のHTMLも最新版へ置き換えてください。');
    return;
  }

  function save(value) {
    if (typeof se.setJSEmbeddedData === 'function') {
      se.setJSEmbeddedData('pd_study_id', value);
      debug('input.saved', { method: 'setJSEmbeddedData', writtenValue: value });
    } else if (typeof se.setEmbeddedData === 'function') {
      se.setEmbeddedData('__js_pd_study_id', value);
      se.setEmbeddedData('pd_study_id', value);
      debug('input.saved', { method: 'setEmbeddedData', writtenValue: value });
    } else {
      throw new Error('embedded_data_api_unavailable');
    }
  }
  try {
    var previous = typeof se.getJSEmbeddedData === 'function'
      ? se.getJSEmbeddedData('pd_study_id')
      : (typeof se.getEmbeddedData === 'function' ? se.getEmbeddedData('pd_study_id') : '');
    if (typeof previous === 'string') input.value = previous;
  } catch (e) { debug('input.restore_error', { error: String(e) }); }

  function validate() {
    var value = String(input.value || '').trim();
    var valid = value.length > 0 && !/[\x00-\x1f]/.test(value);
    q.disableNextButton();
    input.setAttribute('aria-invalid', valid ? 'false' : 'true');
    try {
      // Clear a previously saved ID if the input is erased or becomes invalid.
      save(valid ? value : '');
    } catch (e) {
      debug('input.save_error', { error: String(e) });
      showError('参加者IDを保存できません。研究担当者にお知らせください。');
      return;
    }
    if (!valid) {
      showError(value ? '改行や制御文字を含まないIDを入力してください。' : '参加者IDを入力すると次へ進めます。');
      return;
    }
    showError('');
    q.enableNextButton();
  }
  input.addEventListener('input', validate);
  input.addEventListener('change', validate);
  se.addOnPageSubmit(function (type) {
    debug('input.submit.before', { navigation: type || null });
    validate();
    debug('input.submit.after');
  });
  se.addOnUnload(function () {
    debug('input.unload');
    input.removeEventListener('input', validate);
    input.removeEventListener('change', validate);
  });
  validate();
});
