function pdSetEmbeddedData(key, val) {
  try {
    if (!(window.Qualtrics && Qualtrics.SurveyEngine)) return false;
    var v = (typeof val === "string") ? val : JSON.stringify(val);
    if (typeof Qualtrics.SurveyEngine.setJSEmbeddedData === "function") {
      Qualtrics.SurveyEngine.setJSEmbeddedData(key, v);
      return true;
    }
    if (typeof Qualtrics.SurveyEngine.setEmbeddedData === "function") {
      Qualtrics.SurveyEngine.setEmbeddedData(key, v);
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

function pdRevealNextButton(q) {
  try {
    q.showNextButton();
    q.hidePreviousButton();
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

Qualtrics.SurveyEngine.addOnload(function () {
  var q = this;
  
  window.__PD_GAME_OVER__ = false;
  window.__PD_SURVEY_READY__ = false;
  window.__PD_REMATCHING__ = false;

  var btn = document.getElementById("exit_button");
  if (btn) {
    btn.addEventListener("click", function () {
      var ok = window.confirm(
        "これは緊急離脱用のボタンです。\n緊急離脱するとゲームは中断され、追加報酬も受け取れません。\nよろしいですか？"
      );
      if (!ok) return;

      btn.disabled = true;

      // 1) Qualtricsに離脱フラグ（分岐用）
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

      // 2) 待機解除 → 3) ゲーム離脱通知 → 4) RTC切断（順に、可能なものだけ）
      var p = Promise.resolve();

      p = p.then(function () {
        try {
          if (window.__PD_CANCEL_MATCH__) return window.__PD_CANCEL_MATCH__();
        } catch (e) {}
      }).then(function () {
        try {
          if (!window.__PD_LEAVE_CALLED__ && typeof window.__PD_LEAVE__ === "function") {
            window.__PD_LEAVE_CALLED__ = true;
            return window.__PD_LEAVE__("user_exit");
          }
        } catch (e) {}
      }).finally(function () {
        // 5) 次へ
        pdRevealNextButton(q);
        var nb = document.getElementById("NextButton");
        if (nb) nb.click();
      });
    });
  }

  q.hideNextButton();
  q.hidePreviousButton();

  // マッチング中の見た目
  var container = document.querySelector(".container");
  if (container) container.classList.add("pre_match");

  // ゲーム開始検知（layout_choice が active になったら）
  var startWatch = setInterval(function () {
    var lc = document.getElementById("layout_choice");
    if (lc && lc.classList.contains("is_active")) {
      if (container) container.classList.remove("pre_match");
      clearInterval(startWatch);
    }
  }, 200);

  // 正式終了フラグ監視
  var interval = setInterval(function () {
    if (window.__PD_SURVEY_READY__ === true) {
      clearInterval(interval);
      pdSaveRuntimeSnapshot("survey_ready");

      // 同じQualtrics設問が再ロードされてもゲームを再スタートしないための印
      try {
        var pidForFinish =
          (window.__PD__ && window.__PD__.participantId) ||
          (window.__PD__ && window.__PD__.responseId) ||
          "";
        if (pidForFinish) {
          localStorage.setItem("pd_finished_" + pidForFinish, "1");
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

  // ResponseID共有
  var rid = "${e://Field/ResponseID}";
  if (!rid || rid.indexOf("${") === 0) {
    rid = "";
    pdSetEmbeddedData("pd_response_id_missing", "1");
  } else {
    pdSetEmbeddedData("pd_response_id_missing", "0");
  }

  var pid = rid;
  try {
    if (!pid) {
      pid = localStorage.getItem("pd_player_id");
      if (!pid && window.crypto && crypto.randomUUID) {
        pid = crypto.randomUUID();
        localStorage.setItem("pd_player_id", pid);
      }
    }
  } catch (e) {}

  window.__PD__ = {
    responseId: rid,
    participantId: pid || "",
  };
  pdSetEmbeddedData("pd_player_id_from_qjs", pid || "");

  // すでにゲーム終了済みなら、match.jsを読み込まない
  try {
    var finishedKey = pid ? "pd_finished_" + pid : "";
    if (finishedKey && localStorage.getItem(finishedKey) === "1") {
      window.__PD_DISABLE_AUTO_START__ = true;
      pdSetEmbeddedData("pd_loader_status", "already_finished");
  
      pdRevealNextButton(q);
  
      return;
    }
  } catch (e) {}

  if (window.__PD_APP_LOADING__ || window.__PD_APP_LOADED__) {
    pdSetEmbeddedData("pd_loader_status", "duplicate_skipped");
    return;
  }
  window.__PD_APP_LOADING__ = true;
  pdSetEmbeddedData("pd_loader_status", "loading");
  pdSetEmbeddedData("pd_loader_started_at", String(Date.now()));

  // Agora App ID
  window.AGORA_APP_ID = "5280cae082864cb9bcd37f818be5ca34";

  // Agora SDK
  var rtc = document.createElement("script");
  rtc.src = "https://download.agora.io/sdk/release/AgoraRTC_N-4.20.0.js";
  rtc.onerror = function () {
    window.__PD_APP_LOADING__ = false;
    pdSetEmbeddedData("pd_loader_status", "agora_load_failed");
    pdSetEmbeddedData("pd_loader_failed_at", String(Date.now()));
  };
  rtc.onload = function () {
    // match.js (module)
    var app = document.createElement("script");
    app.type = "module";
    app.src = "https://multimodalpd-static-65p9.onrender.com/match.js";
    app.onload = function () {
      window.__PD_APP_LOADING__ = false;
      window.__PD_APP_LOADED__ = true;
      pdSetEmbeddedData("pd_loader_status", "loaded");
      pdSetEmbeddedData("pd_loader_loaded_at", String(Date.now()));
    };
    app.onerror = function () {
      window.__PD_APP_LOADING__ = false;
      pdSetEmbeddedData("pd_loader_status", "match_load_failed");
      pdSetEmbeddedData("pd_loader_failed_at", String(Date.now()));
    };
    document.head.appendChild(app);
  };
  document.head.appendChild(rtc);
});

Qualtrics.SurveyEngine.addOnUnload(function () {
  try {
    pdSaveRuntimeSnapshot("unload");
    // リロード時は「最終離脱」にしない。
    // ここでは soft pause だけ送る。
    if (typeof window.__PD_SOFT_PAUSE__ === "function") {
      window.__PD_SOFT_PAUSE__();
    }
  } catch (e) {}
});
