var PD_QJS_VERSION = "2026-10-24-id-debug-v3";

function pdIdDebug(stage, extra) {
  function inspect(method, key) {
    try {
      var se = window.Qualtrics && Qualtrics.SurveyEngine;
      if (!se || typeof se[method] !== "function") return { available: false };
      var value = se[method](key);
      return { available: true, type: typeof value, value: value === undefined ? null : value };
    } catch (e) { return { available: true, error: String(e) }; }
  }
  console.log("[PD-ID] " + JSON.stringify({
    stage: stage, at: new Date().toISOString(), version: PD_QJS_VERSION,
    readyState: document.readyState,
    pipedId: "${e://Field/pd_study_id}",
    pipedJSId: "${e://Field/__js_pd_study_id}",
    responseId: "${e://Field/ResponseID}",
    jsId: inspect("getJSEmbeddedData", "pd_study_id"),
    regularId: inspect("getEmbeddedData", "pd_study_id"),
    prefixedId: inspect("getEmbeddedData", "__js_pd_study_id"),
    windowStudyId: window.__PD__ ? window.__PD__.studyId : null,
    windowResponseId: window.__PD__ ? window.__PD__.responseId : null,
    appLoading: !!window.__PD_APP_LOADING__, appLoaded: !!window.__PD_APP_LOADED__,
    extra: extra || null
  }));
}
pdIdDebug("game.script_evaluated");

function pdSetEmbeddedData(key, val) {
  try {
    if (!(window.Qualtrics && Qualtrics.SurveyEngine)) return false;
    var v = (typeof val === "string") ? val : JSON.stringify(val);
    var se = Qualtrics.SurveyEngine;
    if (typeof se.setJSEmbeddedData === "function") {
      se.setJSEmbeddedData(key, v);
      return true;
    }
    if (typeof se.setEmbeddedData === "function") {
      se.setEmbeddedData(key, v);
      return true;
    }
  } catch (e) {}
  return false;
}

function pdSaveRuntimeSnapshot(reason) {
  try {
    pdSetEmbeddedData("pd_snapshot_reason", reason || "");
    pdSetEmbeddedData("pd_snapshot_at", String(Date.now()));
    pdSetEmbeddedData("pd_snapshot_phase", window.__PD_CURRENT_PHASE__ || "");
    pdSetEmbeddedData("pd_snapshot_room", window.__PD_CURRENT_ROOM__ || "");
    pdSetEmbeddedData("pd_snapshot_seat", window.__PD_CURRENT_SEAT__ || "");
    pdSetEmbeddedData("pd_snapshot_left_pid", window.__PD_CURRENT_LEFT_PID__ || "");
    pdSetEmbeddedData("pd_snapshot_right_pid", window.__PD_CURRENT_RIGHT_PID__ || "");
    pdSetEmbeddedData("pd_snapshot_recording_status", window.__PD_RECORDING_STATUS__ || "");
    pdSetEmbeddedData("pd_snapshot_survey_ready", window.__PD_SURVEY_READY__ === true ? "1" : "0");
  } catch (e) {}
}

function pdHideNextButton(q) {
  try {
    if (q && typeof q.hideNextButton === "function") q.hideNextButton();
    if (q && typeof q.hidePreviousButton === "function") q.hidePreviousButton();
  } catch (e) {}

  var els = document.querySelectorAll("#NextButton, #PreviousButton, #Buttons");
  for (var i = 0; i < els.length; i++) {
    els[i].style.setProperty("display", "none", "important");
    els[i].style.setProperty("visibility", "hidden", "important");
    els[i].style.setProperty("pointer-events", "none", "important");
  }
}

function pdRevealNextButton(q) {
  try {
    if (q && typeof q.showNextButton === "function") q.showNextButton();
    if (q && typeof q.hidePreviousButton === "function") q.hidePreviousButton();
  } catch (e) {}

  var els = document.querySelectorAll("#NextButton, #Buttons");
  for (var i = 0; i < els.length; i++) {
    els[i].style.setProperty("display", "block", "important");
    els[i].style.setProperty("visibility", "visible", "important");
    els[i].style.setProperty("pointer-events", "auto", "important");
  }

  var prev = document.getElementById("PreviousButton");
  if (prev) {
    prev.style.setProperty("display", "none", "important");
    prev.style.setProperty("visibility", "hidden", "important");
    prev.style.setProperty("pointer-events", "none", "important");
  }
}

function pdIsUnresolvedPipedText(value) {
  value = String(value || "");
  return value.charAt(0) === "$" && value.charAt(1) === "{";
}

function pdGetResponseId() {
  var rid = "${e://Field/ResponseID}";
  if (!rid || pdIsUnresolvedPipedText(rid)) return "";
  return String(rid);
}

function pdGetParticipantId(rid) {
  if (rid) return rid;

  var pid = "";
  try {
    pid = sessionStorage.getItem("pd_player_id_session") || "";
    if (!pid && window.crypto && crypto.randomUUID) {
      pid = crypto.randomUUID();
      sessionStorage.setItem("pd_player_id_session", pid);
    }
  } catch (e) {}
  return pid;
}

function pdLoadGameScripts() {
  pdIdDebug("game.load_scripts.request");
  if (window.__PD_APP_LOADING__ || window.__PD_APP_LOADED__) {
    pdIdDebug("game.load_scripts.skipped");
    pdSetEmbeddedData("pd_loader_status", "duplicate_skipped");
    return;
  }

  window.__PD_APP_LOADING__ = true;
  pdSetEmbeddedData("pd_loader_status", "loading");
  pdSetEmbeddedData("pd_loader_started_at", String(Date.now()));

  window.AGORA_APP_ID = "5280cae082864cb9bcd37f818be5ca34";

  var rtc = document.createElement("script");
  rtc.src = "https://download.agora.io/sdk/release/AgoraRTC_N-4.20.0.js";
  rtc.onerror = function () {
    pdIdDebug("game.agora_script.error");
    window.__PD_APP_LOADING__ = false;
    pdSetEmbeddedData("pd_loader_status", "agora_load_failed");
    pdSetEmbeddedData("pd_loader_failed_at", String(Date.now()));
  };
  rtc.onload = function () {
    pdIdDebug("game.agora_script.loaded");
    var app = document.createElement("script");
    app.type = "module";
    app.src = "https://multimodalpd-static-65p9.onrender.com/match.js";
    app.onload = function () {
      pdIdDebug("game.match_script.loaded", { src: app.src });
      window.__PD_APP_LOADING__ = false;
      window.__PD_APP_LOADED__ = true;
      pdSetEmbeddedData("pd_loader_status", "loaded");
      pdSetEmbeddedData("pd_loader_loaded_at", String(Date.now()));
    };
    app.onerror = function () {
      pdIdDebug("game.match_script.error", { src: app.src });
      window.__PD_APP_LOADING__ = false;
      pdSetEmbeddedData("pd_loader_status", "match_load_failed");
      pdSetEmbeddedData("pd_loader_failed_at", String(Date.now()));
    };
    pdIdDebug("game.match_script.append", { src: app.src });
    document.head.appendChild(app);
  };
  document.head.appendChild(rtc);
}

Qualtrics.SurveyEngine.addOnload(function () {
  var q = this;
  pdIdDebug("game.onload");
  console.log("[PD QJS] loaded", PD_QJS_VERSION);
  pdSetEmbeddedData("pd_qjs_version", PD_QJS_VERSION);

  window.__PD_GAME_OVER__ = false;
  window.__PD_SURVEY_READY__ = false;
  window.__PD_REMATCHING__ = false;

  pdHideNextButton(q);

  var exitButton = document.getElementById("exit_button");
  if (exitButton) {
    exitButton.addEventListener("click", function () {
      var ok = window.confirm(
        "This is an emergency exit button.\nIf you leave now, the game will be stopped and additional reward may not be paid.\nDo you want to continue?"
      );
      if (!ok) return;

      exitButton.disabled = true;
      try {
        pdSaveRuntimeSnapshot("exit_button");
        pdSetEmbeddedData("pd_exit", "1");
        pdSetEmbeddedData("pd_exit_reason", "user_exit");
        pdSetEmbeddedData("pd_exit_phase", window.__PD_CURRENT_PHASE__ || "");
        pdSetEmbeddedData("pd_exit_room", window.__PD_CURRENT_ROOM__ || "");
        pdSetEmbeddedData("pd_exit_at", String(Date.now()));
        if (window.__PD_SURVEY_READY__ !== true) {
          pdSetEmbeddedData("pd_incomplete", "1");
          pdSetEmbeddedData("pd_abort_reason", "user_exit");
          pdSetEmbeddedData("pd_abort_at", String(Date.now()));
        }
      } catch (e) {}

      Promise.resolve()
        .then(function () {
          try {
            if (window.__PD_CANCEL_MATCH__) return window.__PD_CANCEL_MATCH__();
          } catch (e) {}
        })
        .then(function () {
          try {
            if (!window.__PD_LEAVE_CALLED__ && typeof window.__PD_LEAVE__ === "function") {
              window.__PD_LEAVE_CALLED__ = true;
              return window.__PD_LEAVE__("user_exit");
            }
          } catch (e) {}
        })
        .finally(function () {
          pdRevealNextButton(q);
          var nb = document.getElementById("NextButton");
          if (nb) nb.click();
        });
    });
  }

  var container = document.querySelector(".container");
  if (container) container.classList.add("pre_match");

  var startWatch = setInterval(function () {
    var layoutChoice = document.getElementById("layout_choice");
    if (layoutChoice && layoutChoice.classList.contains("is_active")) {
      if (container) container.classList.remove("pre_match");
      clearInterval(startWatch);
    }
  }, 200);

  var finishWatch = setInterval(function () {
    if (window.__PD_SURVEY_READY__ === true) {
      clearInterval(finishWatch);
      pdSaveRuntimeSnapshot("survey_ready");

      try {
        var pdState = window.__PD__ || {};
        var responseIdForFinish = pdState.responseId || "";
        var pidForFinish = pdState.participantId || "";
        if (responseIdForFinish) {
          localStorage.setItem("pd_finished_" + responseIdForFinish, "1");
        } else if (pidForFinish) {
          sessionStorage.setItem("pd_finished_session_" + pidForFinish, "1");
        }
      } catch (e) {}

      var leavePromise = Promise.resolve();
      try {
        if (!window.__PD_LEAVE_CALLED__ && typeof window.__PD_LEAVE__ === "function") {
          window.__PD_LEAVE_CALLED__ = true;
          leavePromise = window.__PD_LEAVE__("game_finished");
        }
      } catch (e) {}

      Promise.resolve(leavePromise).finally(function () {
        pdRevealNextButton(q);
      });
    }
  }, 300);
});

Qualtrics.SurveyEngine.addOnReady(function () {
  var q = this;
  pdIdDebug("game.ready.before_read");
  // Diagnostic reads only: do not retry startup or alter matching behavior.
  window.__PD_ID_DEBUG_TIMERS__ = [0, 500, 2000].map(function (delay) {
    return setTimeout(function () { pdIdDebug("game.ready.delayed_read", { delayMs: delay }); }, delay);
  });
  pdHideNextButton(q);

  var rid = pdGetResponseId();
  pdSetEmbeddedData("pd_response_id_missing", rid ? "0" : "1");

  var pid = pdGetParticipantId(rid);
  var studyId = "${e://Field/pd_study_id}";
  if (pdIsUnresolvedPipedText(studyId)) studyId = "";
  // Custom HTML input saves through the JavaScript Embedded Data API.
  // Keep the regular field as a fallback for existing native-input surveys.
  try {
    if (typeof Qualtrics.SurveyEngine.getJSEmbeddedData === "function") {
      var jsStudyId = Qualtrics.SurveyEngine.getJSEmbeddedData("pd_study_id");
      if (typeof jsStudyId === "string" && jsStudyId.trim()) studyId = jsStudyId;
    }
  } catch (e) { pdIdDebug("game.id_read_error", { error: String(e) }); }
  studyId = String(studyId || "").trim();
  pdIdDebug("game.id_resolved", { selectedStudyId: studyId });
  if (!studyId) {
    pdIdDebug("game.id_missing.stop");
    pdSetEmbeddedData("pd_loader_status", "missing_study_id");
    var notice = document.createElement("p");
    notice.setAttribute("role", "alert");
    notice.textContent = "参加者IDがありません。研究担当者にお知らせください。";
    q.getQuestionContainer().appendChild(notice);
    return;
  }
  window.__PD__ = {
    studyId: studyId,
    responseId: rid,
    participantId: pid || "",
  };
  pdIdDebug("game.window_assigned");
  pdSetEmbeddedData("pd_player_id_from_qjs", pid || "");

  try {
    var finishedKey = pid ? "pd_finished_" + pid : "";
    if (!rid && finishedKey && localStorage.getItem(finishedKey) === "1") {
      localStorage.removeItem(finishedKey);
      pdSetEmbeddedData("pd_loader_ignored_stale_finish", "1");
    }
  } catch (e) {}

  pdLoadGameScripts();
});

Qualtrics.SurveyEngine.addOnUnload(function () {
  pdIdDebug("game.unload");
  (window.__PD_ID_DEBUG_TIMERS__ || []).forEach(clearTimeout);
  try {
    pdSaveRuntimeSnapshot("unload");
    if (typeof window.__PD_SOFT_PAUSE__ === "function") {
      window.__PD_SOFT_PAUSE__();
    }
  } catch (e) {}
});
