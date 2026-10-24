# 参加者ID入力ブロック（HTML内に入力欄を持つ方式）

## 配置と設問

ゲームとは別ブロックで構いません。ID入力→ゲームの順に配置します。間に説明などが入っても構いません。

1. ID入力ブロックの設問を「Text / Graphic（説明文）」にします。Qualtrics標準のテキスト入力設問は使用しません。以前の標準入力欄のForce Response設定も不要です。
2. 設問文のHTML表示に、このフォルダの `Q.html` をstyleタグ・inputタグを含めて全部貼り付けます。
3. 設問のJavaScriptを、このフォルダの `Q.js` に全部置き換えます。
4. ゲーム設問のJavaScriptも `Qualtrics/current/Q.js` の最新版に置き換えます。

入力欄はHTML内で生成し、CSSもHTML内にあります。Q.cssやcurrent/Q.cssへの追記は不要です。このID入力設問は1ページに1つ配置してください。

## Survey Flowの埋め込み変数（従来の手順から変更）

JavaScriptから保存するため、ID入力ブロックより前に `__js_pd_study_id` を定義します。先頭はアンダースコア2つです。初期値は空欄にします。

ID入力ブロックの後で、通常の `pd_study_id` にJS保存値を転記します。以前の「標準テキスト入力設問の回答」を参照していた設定は削除・置換してください。

```text
Embedded Data
  __js_pd_study_id（空欄で定義）
↓
参加者ID入力ブロック
↓
Embedded Data
  pd_study_id = ${e://Field/__js_pd_study_id}
↓
説明等の任意のブロック
↓
ゲームブロック
```

`pd_study_id` の値はPiped TextメニューからEmbedded Dataの `__js_pd_study_id` を選択して設定します。`__js_pd_study_id` を入力後に空欄へ初期化し直さないでください。

JavaScriptは `setJSEmbeddedData('pd_study_id', value)` を使用し、ゲーム側は `getJSEmbeddedData('pd_study_id')` を優先して読み込みます。APIの引数には `__js_` を付けません。従来の通常Embedded Dataからの読み込みも互換性のため維持しています。

## 動作

- 空欄、空白だけ、制御文字を含む入力では次へ進めません。
- 有効な入力は前後の空白を除いてEmbedded Dataへ保存し、次へを有効化します。
- 先頭の0や大文字小文字は維持します。
- 名簿照合やIDの自動発行は行いません。テストではTEST001、TEST002等を使用してください。
- 入力設問は履歴ファイルの設定有無に関係なく使えます。

Survey全体をプレビューし、ID入力からゲームまで進んで確認してください。単体のゲームプレビューでは前段の値は設定されません。Data & Analysisでは `__js_pd_study_id` と `pd_study_id` を確認してください。

## 確認範囲

## ID受け渡しの診断ログ

今回の診断版は通常の保存・マッチング処理を変えず、`[PD-ID]` で始まるログを追加しています。

1. 入力設問のQ.jsとゲーム設問のcurrent/Q.jsをQualtricsに貼り直します。
2. web/match.jsの変更を静的サイトへ反映します。サーバー側の変更は不要です。
3. ID入力ページに進む前に開発者ツールのConsoleを開き、Preserve log（ログを保持）を有効にします。更新前のログを消します。
4. TEST001などの仮IDを入力し、ゲームへ進み、エラー後も3秒ほど待ちます。
5. Consoleで `[PD-ID]` を検索し、input.readyから最後のログまでコピーしてください。ページをまたぐので、Preserve logを必ず有効にします。

主なstage:

- input.saved / input.submit.after: 書き込んだ値と直後のAPI読み出し値。
- game.ready.before_read / game.id_resolved: ゲーム側API・Piped Textと、採用したID。
- game.ready.delayed_read: 初期化から0ms・500ms・2000ms後の取得値。診断だけで再起動・再試行は行いません。
- game.window_assigned: window.__PD__への設定完了。
- game.match_script.append / match.module_evaluated / match.enter_flow: スクリプト読込とマッチング開始の順序。
- match.id_missing.stop: マッチングが参照したIDが空。

各行は時点の値をJSON文字列として固定しているので、後からオブジェクトを展開した際の値の変化を避けられます。復帰トークンは出しません。診断のため入力IDとResponseIDを出すので、仮IDでテストしてください。

期待するバージョンは、入力側 `2026-10-24-id-debug-v1`、ゲーム側 `2026-10-24-id-debug-v3`、match.js側 `match-id-debug-v1` です。該当ログがない・古い版の場合は、そのファイルの反映やキャッシュを確認してください。

## ローカル検証

ローカルではJavaScript構文と、モックAPIによる保存・空欄・保存失敗・ゲーム側読み込みを確認します。実際のQualtrics上の表示とページをまたぐ保存は、公開前に別途確認してください。
