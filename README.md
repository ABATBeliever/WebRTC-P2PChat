# WebRTC-P2PChat

ブラウザ同士が直接通信するP2Pなチャットのサンプル実装です。  
メッセージ・ファイルはサーバーを経由せずブラウザ間でやり取りされます。


## 構成ファイル

|ファイル|役割|
|-|-|
|`p2p-chat.js`|チャット機能の全ロジック|
|`p2p-chat.css`|スタイル|

HTMLページ側に必要な記述は以下の2行のみです。

```html
<div id="p2p-chat-root"></div>
<script src="p2p-chat.js"></script>
```

外部依存は **PeerJS**（CDN等で読み込み）のみです。

```html
<script src="https://unpkg.com/peerjs@1/dist/peerjs.min.js"></script>
```

## アーキテクチャ

### 通信の仕組み

- 接続確立のみシグナリングサーバーを使用、それ以降の通信は純粋なP2P
- 3人以上が参加する場合、全員が互いに直接接続するフルメッシュ構造
- 新規参加者は、全員に接続して回る

### マスター制度

最初に部屋を作ったユーザは 「マスター」という立場になります。   
マスターが退出する、またはマスター以外誰もいなくなったときは、セッションが終了します。ゲストの退出はそのユーザとの接続のみが切れます。

## 機能一覧

### テキストメッセージ

- Enterで送信、Shift+Enterで改行可能
- 送信済みメッセージに既読チェック `✓` を表示
- 入力中インジケーター

### 他者の発言への応答

#### 返信
- ボタンを押すと入力欄上部にリプライバーが出現し、引用元（送信者名と本文冒頭60文字）を表示
- 送信すると受信側の吹き出しに引用ブロックが付与される

#### リアクション

- ボタンを押すと絵文字ピッカーが登場し、5つから選ぶ
- リアクション数はバッジ（絵文字 + 人数）として発言の下に表示

### ファイル送受信

- 「📎」ボタンからファイルを選択
- 512MB を超えるファイルはアップロード拒否
- 送信前・受信前にそれぞれ免責事項の確認ダイアログが出る
- SHA-256 ハッシュによる整合性検証
- 受信後はダウンロードリンクを表示、画像ファイルの場合プレビューあり

### 招待

|方法|内容|
|-|-|
|IDで招待|自分のピアIDをクリップボードにコピー|
|URLで招待|`?connect=<ID>` 付きURLをコピー。開いた相手はIDが自動入力済みになる|

### 参加・退出通知

セッション内の全員にシステムメッセージで通知されます。  
フルメッシュ構築時に複数の接続から同名ユーザの参加通知が重複して届く場合、同一名前の通知は3秒以内の重複を無視します。  
※なぜか通知が増殖するバグを解決できなかったため

## データプロトコル

PeerJS の DataChannel（reliable モード）でJSON相当のオブジェクトを送受信。

|`type`|方向|内容|
|-|-|-|
|`message`|broadcast|テキストメッセージ本体|
|`read`|1対1|既読通知|
|`typing`|broadcast|入力中シグナル|
|`peers`|1対1|他ピアのIDリスト|
|`roster`|broadcast|全員の名前マップ|
|`file\_meta`|broadcast|ファイル送信予告（名前・サイズ・MIME・SHA-256）|
|`file`|broadcast|ファイル本体（Base64 DataURL）|
|`reaction`|broadcast|リアクション（msgId・絵文字・送信者ID）|
|`room\_closed`|broadcast|マスターによる部屋クローズ通知|

### message オブジェクト

```js
{
  type:      'message',
  text:      string,      // 本文
  from:      string,      // 送信者名
  msgId:     string,      // "<peerId>\_<連番>"
  ts:        number,      // Unix タイムスタンプ (ms)
  replyTo:   string|null, // 返信先 msgId
  replyText: string|null, // 返信先本文（引用表示用）
  replyFrom: string|null, // 返信先送信者名
}
```

### file / file\_meta オブジェクト

```js
{
  type:  'file' | 'file\_meta',
  msgId: string,
  name:  string,   // ファイル名
  size:  number,   // バイト数
  mime:  string,   // MIMEタイプ
  sha256: string,  // 16進SHA-256ハッシュ
  from:  string,
  ts:    number,
  data:  string,   // Base64 DataURL（file のみ）
}
```

## 定数・制約

|定数|値|説明|
|-|-|-|
|`FILE\_SIZE\_LIMIT`|128 MB|送信可能なファイルの上限|
|`REACTION\_EMOJIS`|👍 🫠 🎉 🥹 🤔|選択可能なリアクション絵文字|
|`JOIN\_DEDUP\_MS`|3000 ms|参加通知の重複抑制ウィンドウ|
|ユーザ名 `maxlength`|32文字|入力欄の上限|

## 主要な関数

### 接続管理

|関数|説明|
|-|-|
|`init()`|PeerJS初期化・HTML描画・イベント登録|
|`connectToPeer(targetId?)`|指定IDまたは入力欄のIDへ接続|
|`setupConn(conn)`|接続ハンドラの登録（open / data / close / error）|
|`disconnect()`|セッション終了（マスター時は全員にroom\_closedを送信）|
|`broadcastRoster()`|全員へ名前マップを同期|

### メッセージング

|関数|説明|
|-|-|
|`sendMessage()`|テキスト送信|
|`broadcast(data)`|全接続へデータ送信|
|`handleData(conn, data)`|受信データのディスパッチ|
|`appendMsg(data, isMe)`|メッセージ吹き出しをDOMに追加|
|`markRead(msgId, peerId)`|既読マーク更新|

### 返信

|関数|説明|
|-|-|
|`setReplyTarget(msgId)`|返信モードを開始し、リプライバーを表示|
|`cancelReply()`|返信モードを解除|

### リアクション

|関数|説明|
|-|-|
|`sendReaction(msgId, emoji)`|リアクションを送信|
|`handleReactionReceived(...)`|受信したリアクションを状態に反映|
|`updateReactionUI(msgId)`|リアクションバッジをDOMに再描画|

### ファイル

|関数|説明|
|-|-|
|`sendFiles(input)`|ファイル選択後の前処理（サイズチェック・免責確認）|
|`sendFileSingle(file)`|1ファイルのSHA-256計算・送信|
|`handleFileReceived(conn, data)`|ファイル受信・検証・URL生成|
|`markFileRecvDone(msgId, url, data)`|受信完了UIを更新（画像はインライン表示）|
