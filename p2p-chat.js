(function () {
  'use strict';

  let peer      = null;
  let myId      = null;
  let myName    = 'ユーザ' + Math.random().toString(36).slice(2, 6).toUpperCase();
  let isMaster  = false;
  let masterId  = null;
  let connections   = {};
  let roster        = {};
  let typingTimers  = {};
  let typingPeers   = new Set();
  let msgIdCounter  = 0;
  let sentMsgs      = {};
  let roomClosedIntentionally = false;

  // リアクション: { msgId: { emoji: Set<peerId> } }
  let reactions = {};

  let replyTarget = null;

  let joinedPeers = new Set();
  let joinedNames = new Map();
  const JOIN_DEDUP_MS = 3000;

  const FILE_SIZE_LIMIT = 128 * 1024 * 1024; // 128MB
  const REACTION_EMOJIS = ['👍','🫠','🎉','🥹','🤔'];

  const $ = id => document.getElementById(id);

  // ===== INIT =====

  function init() {
    renderHTML();
    bindEvents();

    peer = new Peer({ debug: 0 });

    peer.on('open', id => {
      myId     = id;
      isMaster = true;
      masterId = id;
      roster[id] = myName;

      $('p2p-my-id').textContent = id;
      $('p2p-connect-btn').disabled = false;

      const targetId = new URLSearchParams(location.search).get('connect');
      if (targetId && targetId !== myId) {
        $('p2p-peer-id-input').value = targetId;
        isMaster = false;
        const hint = $('p2p-setup-hint');
        if (hint) hint.textContent = '👆 ユーザ名を入力して「接続」を押してください。';
      }
    });

    peer.on('connection', conn => setupConn(conn));
    peer.on('error', e => toast('⚠ ' + e.message));
    peer.on('disconnected', () => {});
  }

  // ===== HTML =====

  function renderHTML() {
    const root = $('p2p-chat-root');
    if (!root) { console.error('p2p-chat: #p2p-chat-root が見つかりません'); return; }

    root.innerHTML = `
      <div id="p2p-agree">
        <div id="p2p-agree-inner">
          <h2>WebRTCサンプル - P2Pチャット について</h2>
          <div id="p2p-agree-body">
            <h3>仕組み</h3>
            <p>このチャットはWebRTC（PeerJS）を使ったP2Pの通信技術デモです。<br>メッセージやファイルはブラウザ間で直接やり取りされ、当サイトを経由しません。<br>接続確立のみ、PeerJSの無料シグナリングサーバー（peerjs.com）を使用します。これは第三者が提供するシグナリングサーバーです。<br>本サービスはWebRTCの利用例サンプルとして利用者間の直接通信を提供するものであり、当サイトは通信の内容や結果に関与しません。</p>
            <h3>プライバシーについて</h3>
            <p>送受信されるデータはWebRTCのDTLS暗号化により保護されます。ただし、接続相手のIPアドレスはWebRTCの性質上、接続するすべてのメンバーに相互に開示されます。<br>送受信したファイルやメッセージはサーバーを経由せず、取得・保存もされません。それらのデータは、セッションが終了した時に各自のブラウザで消去を試行します。<br>※ホストとは最初にチャットに招待した人を指します。<br>※事前に何らかの方法で保存されていたものは削除されません。</p>
            <h3>法的事項・ファイル送受信について</h3>
            <p>著作権物・違法なコンテンツのやり取りは禁止です。ファイルの送受信は自己責任で、特に注意して行ってください。<br>当サイトは、この技術デモに関して合理的な範囲で安全性確保に努めますが、通信内容を保存・監視していないため、通報や削除対応は行えません。<br>また、利用者間の通信内容、送受信されたファイル、またはこれに起因して生じた損害について、一切の責任を負いません。<br>ここに共有したすべての会話、ファイルは、セッションに参加したメンバーが保存することがあり得る点に留意ください。</p>
            <h3>特定地域の利用について</h3>
            <p>本サービスは、インターネットやP2P技術が利用できない何らかの地域での利用を想定していません。また、国連決議等の回避を助長するものではありません。利用を開始した時点で、問題ない地域に居住していると申告したものとします。</p>
            <h3>未成年の利用について</h3>
            <p>未成年の方は保護者の同意のもと利用してください。利用を開始した時点で、保護者の同意を得た未成年または成年であると申告したものとします。</p>
          </div>
          <label id="p2p-agree-label">
            <input type="checkbox" id="p2p-agree-check" />
            上記の内容を理解し、同意します
          </label>
          <button class="p2p-btn" id="p2p-agree-btn" disabled>同意して続ける</button>
        </div>
      </div>

      <div id="p2p-setup" style="display:none">
        <div id="p2p-setup-inner">
          <h2>WebRTCサンプル - P2Pチャット</h2>
          <div class="p2p-field">
            <label for="p2p-name-input">ユーザ名</label>
            <input type="text" id="p2p-name-input" maxlength="32" />
          </div>
          <div class="p2p-field">
            <label>あなたのID</label>
            <div class="p2p-myid-row">
              <span id="p2p-my-id">接続中...</span>
              <button class="p2p-btn" id="p2p-copy-url-setup-btn">URLで招待</button>
              <button class="p2p-btn" id="p2p-copy-id-btn">IDで招待</button>
            </div>
          </div>
          <div class="p2p-divider">または</div>
          <div class="p2p-field">
            <label for="p2p-peer-id-input">相手のIDを入力して接続</label>
            <div class="p2p-connect-row">
              <input type="text" id="p2p-peer-id-input" placeholder="相手のID" />
              <button class="p2p-btn" id="p2p-connect-btn" disabled>接続</button>
            </div>
          </div>
          <div id="p2p-setup-hint">
            💡 招待URLで来た場合は、相手のIDはすでに入力されています
          </div>
        </div>
      </div>

      <div id="p2p-chat">
        <div id="p2p-chat-header">
          <div id="p2p-peers-wrap">
            <span id="p2p-peers-label"></span>
          </div>
          <div id="p2p-header-actions">
            <button class="p2p-btn" id="p2p-share-btn">URLで招待</button>
            <button class="p2p-btn" id="p2p-share-id-btn">IDで招待</button>
            <button class="p2p-btn" id="p2p-disconnect-btn">会話から離脱する</button>
          </div>
        </div>
        <div id="p2p-messages"></div>
        <div id="p2p-typing"></div>
        <div id="p2p-reply-bar" style="display:none">
          <span id="p2p-reply-label"></span>
          <button id="p2p-reply-cancel">✕</button>
        </div>
        <div id="p2p-input-bar">
          <button id="p2p-file-btn" title="ファイルを送る">📎</button>
          <input type="file" id="p2p-file-input" style="display:none" multiple />
          <textarea id="p2p-msg-input" placeholder="メッセージ...(Shift+Enterで改行)" rows="1"></textarea>
          <button id="p2p-send-btn" disabled>送信する</button>
        </div>
      </div>
    `;

    const nameInput = $('p2p-name-input');
    if (nameInput) { nameInput.value = myName; nameInput.placeholder = myName; }
  }

  // ===== EVENTS =====

  function bindEvents() {
    document.addEventListener('change', e => {
      if (e.target.id === 'p2p-agree-check') {
        const btn = $('p2p-agree-btn');
        if (btn) btn.disabled = !e.target.checked;
      }
      if (e.target.id === 'p2p-file-input') sendFiles(e.target);
    });

    document.addEventListener('input', e => {
      if (e.target.id === 'p2p-name-input') {
        const v = e.target.value.trim();
        if (v) { myName = v; roster[myId] = v; }
      }
      if (e.target.id === 'p2p-msg-input') {
        autoResize(e.target);
        sendTypingSignal();
        $('p2p-send-btn').disabled = e.target.value.trim() === '';
      }
    });

    document.addEventListener('keydown', e => {
      if (e.target.id === 'p2p-msg-input' && e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    document.addEventListener('click', e => {
      const id = e.target.id;
      if (id === 'p2p-agree-btn')          showSetup();
      if (id === 'p2p-connect-btn')        connectToPeer();
      if (id === 'p2p-copy-id-btn')        copyText(myId, 'IDをコピーしました');
      if (id === 'p2p-copy-url-setup-btn') copyText(shareUrl(), 'URLをコピーしました');
      if (id === 'p2p-share-btn')          copyText(shareUrl(), 'URLをコピーしました');
      if (id === 'p2p-share-id-btn')       copyText(myId, 'IDをコピーしました');
      if (id === 'p2p-send-btn')           sendMessage();
      if (id === 'p2p-file-btn')           $('p2p-file-input').click();
      if (id === 'p2p-disconnect-btn')     disconnect();
      if (id === 'p2p-reply-cancel')       cancelReply();

      // 「反応」トグルボタン
      const reactionOpenBtn = e.target.closest('.p2p-reaction-open-btn');
      if (reactionOpenBtn) {
        const msgId = reactionOpenBtn.dataset.msgid;
        const picker = document.getElementById('p2p-picker-' + msgId);
        if (!picker) return;
        const isOpen = picker.style.display !== 'none';
        // 他のピッカーを全部閉じる
        document.querySelectorAll('.p2p-reaction-picker').forEach(p => { p.style.display = 'none'; });
        if (!isOpen) picker.style.display = 'flex';
        return;
      }

      // リアクション絵文字ボタン
      const reactionBtn = e.target.closest('.p2p-reaction-btn');
      if (reactionBtn) {
        const msgId = reactionBtn.dataset.msgid;
        sendReaction(msgId, reactionBtn.dataset.emoji);
        // ピッカーを閉じる
        const picker = document.getElementById('p2p-picker-' + msgId);
        if (picker) picker.style.display = 'none';
        return;
      }

      // ピッカー以外をクリックしたら全ピッカーを閉じる
      if (!e.target.closest('.p2p-reaction-picker') && !e.target.closest('.p2p-reaction-open-btn')) {
        document.querySelectorAll('.p2p-reaction-picker').forEach(p => { p.style.display = 'none'; });
      }
      // 返信ボタン
      const replyBtn = e.target.closest('.p2p-reply-btn');
      if (replyBtn) {
        setReplyTarget(replyBtn.dataset.msgid);
      }
    });
  }

  // ===== CONNECTION =====

  function connectToPeer(targetId) {
    const id = targetId || $('p2p-peer-id-input').value.trim();
    if (!id || id === myId || connections[id]) return;
    const conn = peer.connect(id, {
      metadata: { name: myName, masterId: isMaster ? myId : masterId },
      reliable: true
    });
    setupConn(conn);
  }

  function setupConn(conn) {
    conn.on('open', () => {
      connections[conn.peer] = conn;

      const peerMasterId = conn.metadata?.masterId;
      if (peerMasterId && !isMaster) masterId = peerMasterId;

      roster[myId]      = myName;
      roster[conn.peer] = conn.metadata?.name || conn.peer.slice(0, 8) + '...';
      broadcastRoster();

      showChat();

      // 参加通知の重複を防ぐ
      // ① 同一peerId（接続ごとに1回）
      // ② 同名ユーザの通知が JOIN_DEDUP_MS 以内に来た場合（3人目参加時にAとBから同時通知が届く問題）
      const joinName = roster[conn.peer];
      const lastJoinAt = joinedNames.get(joinName) || 0;
      const isNameDup = (Date.now() - lastJoinAt) < JOIN_DEDUP_MS;
      if (!joinedPeers.has(conn.peer) && !isNameDup) {
        joinedPeers.add(conn.peer);
        joinedNames.set(joinName, Date.now());
        sysMsg(joinName + ' がセッションに参加しました');
      } else {
        joinedPeers.add(conn.peer); // 通知はしないがIDは登録
      }

      const others = Object.keys(connections).filter(id => id !== conn.peer);
      if (others.length) conn.send({ type: 'peers', ids: others, masterId });
    });

    conn.on('data', data => handleData(conn, data));

    conn.on('close', () => {
      if (roomClosedIntentionally) return;
      const name = roster[conn.peer] || conn.peer.slice(0, 8) + '...';
      delete connections[conn.peer];
      delete roster[conn.peer];
      joinedPeers.delete(conn.peer);

      updatePeersUI();
      if (!Object.keys(connections).length) showSetup();
      sysMsg(name + ' が退出しました');
      typingPeers.delete(conn.peer);
      updateTypingUI();
      broadcastRoster();
    });

    conn.on('error', e => toast('接続エラー: ' + e.message));
  }

  function disconnect() {
    if (isMaster) {
      broadcast({ type: 'room_closed', reason: 'マスターが部屋をクローズしました' });
    }
    roomClosedIntentionally = true;
    Object.values(connections).forEach(c => { try { c.close(); } catch(e){} });
    connections = {};
    roster = {};
    joinedPeers.clear();
    joinedNames.clear();
    showSetup();
  }

  // ===== DATA HANDLER =====

  function handleData(conn, data) {
    if (!data?.type) return;
    switch (data.type) {
      case 'message':
        appendMsg(data, false);
        try { conn.send({ type: 'read', msgId: data.msgId }); } catch(e) {}
        break;

      case 'file_meta':  appendFileIncoming(data); break;

      case 'file':
        handleFileReceived(conn, data);
        break;

      case 'read':
        markRead(data.msgId, conn.peer);
        break;

      case 'typing':
        typingPeers.add(conn.peer);
        updateTypingUI();
        clearTimeout(typingTimers[conn.peer]);
        typingTimers[conn.peer] = setTimeout(() => {
          typingPeers.delete(conn.peer); updateTypingUI();
        }, 2500);
        break;

      case 'peers':
        if (data.masterId && !isMaster) masterId = data.masterId;
        (data.ids || []).forEach(id => { if (id !== myId && !connections[id]) connectToPeer(id); });
        break;

      case 'roster': {
        const incoming = data.roster || {};
        Object.keys(incoming).forEach(id => {
          if (id !== myId) roster[id] = incoming[id];
        });
        if (data.masterId) masterId = data.masterId;
        updatePeersUI();
        break;
      }

      case 'room_closed':
        handleRoomClosed();
        break;

      case 'reaction':
        handleReactionReceived(data.msgId, data.emoji, conn.peer);
        break;
    }
  }

  function broadcastRoster() {
    roster[myId] = myName;
    broadcast({ type: 'roster', roster: { ...roster }, masterId });
    updatePeersUI();
  }

  function handleRoomClosed() {
    if (roomClosedIntentionally) return;
    roomClosedIntentionally = true;
    Object.values(connections).forEach(c => { try { c.close(); } catch(e){} });
    connections = {};
    roster = {};
    joinedPeers.clear();
    joinedNames.clear();
    showSetup();
    alert('マスターが部屋をクローズしたため、退出しました。');
  }

  // ===== MESSAGING =====

  function sendMessage() {
    const input = $('p2p-msg-input');
    const text = input.value.trim();
    if (!text || !Object.keys(connections).length) return;
    const msgId = myId + '_' + (++msgIdCounter);
    const data = {
      type: 'message', text, from: myName, msgId, ts: Date.now(),
      replyTo:   replyTarget ? replyTarget.msgId : null,
      replyText: replyTarget ? replyTarget.text  : null,
      replyFrom: replyTarget ? replyTarget.from  : null,
    };
    broadcast(data);
    appendMsg(data, true);
    input.value = '';
    input.style.height = '';
    $('p2p-send-btn').disabled = true;
    cancelReply();
  }

  function broadcast(data) {
    Object.values(connections).forEach(c => { try { c.send(data); } catch(e){} });
  }

  let typingTimer = null;
  function sendTypingSignal() {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => broadcast({ type: 'typing' }), 300);
  }

  // ===== REPLY =====

  function setReplyTarget(msgId) {
    const el = $('p2p-msg-' + msgId);
    if (!el) return;
    const textEl   = el.querySelector('.p2p-msg-text');
    const senderEl = el.querySelector('.p2p-sender');
    replyTarget = {
      msgId,
      text: textEl   ? textEl.textContent   : '',
      from: senderEl ? senderEl.textContent : '',
    };
    const bar   = $('p2p-reply-bar');
    const label = $('p2p-reply-label');
    if (bar && label) {
      const preview = replyTarget.text.slice(0, 30) + (replyTarget.text.length > 30 ? '…' : '');
      label.textContent = '↩ ' + replyTarget.from + '「' + preview + '」に返信';
      bar.style.display = 'flex';
    }
    const inp = $('p2p-msg-input');
    if (inp) inp.focus();
  }

  function cancelReply() {
    replyTarget = null;
    const bar = $('p2p-reply-bar');
    if (bar) bar.style.display = 'none';
  }

  // ===== REACTION =====

  function sendReaction(msgId, emoji) {
    if (!reactions[msgId]) reactions[msgId] = {};
    // 同一メッセージへの自分のリアクションは1つのみ
    for (const e of REACTION_EMOJIS) {
      if (reactions[msgId][e] && reactions[msgId][e].has(myId)) {
        toast('既にリアクション済みです');
        return;
      }
    }
    if (!reactions[msgId][emoji]) reactions[msgId][emoji] = new Set();
    reactions[msgId][emoji].add(myId);
    updateReactionUI(msgId);
    broadcast({ type: 'reaction', msgId, emoji, from: myId });
  }

  function handleReactionReceived(msgId, emoji, peerId) {
    if (!reactions[msgId]) reactions[msgId] = {};
    for (const e of REACTION_EMOJIS) {
      if (reactions[msgId][e] && reactions[msgId][e].has(peerId)) return; // 1つのみ
    }
    if (!reactions[msgId][emoji]) reactions[msgId][emoji] = new Set();
    reactions[msgId][emoji].add(peerId);
    updateReactionUI(msgId);
  }

  function updateReactionUI(msgId) {
    const el = $('p2p-msg-' + msgId);
    if (!el) return;
    let bar = el.querySelector('.p2p-reactions');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'p2p-reactions';
      const meta = el.querySelector('.p2p-meta');
      if (meta) el.insertBefore(bar, meta);
      else el.appendChild(bar);
    }
    bar.innerHTML = '';
    const msgReactions = reactions[msgId] || {};
    REACTION_EMOJIS.forEach(emoji => {
      const set = msgReactions[emoji];
      if (!set || set.size === 0) return;
      const badge = document.createElement('span');
      badge.className = 'p2p-reaction-badge' + (set.has(myId) ? ' mine' : '');
      badge.textContent = emoji + '\u202F' + set.size;
      bar.appendChild(badge);
    });
  }

  // ===== FILE SEND =====

  function sendFiles(input) {
    const files = Array.from(input.files);
    input.value = '';
    if (!files.length) return;

    const tooBig = files.filter(f => f.size > FILE_SIZE_LIMIT);
    if (tooBig.length) {
      alert('以下のファイルは16MBを超えているため送信できません:\n' +
        tooBig.map(f => '・' + f.name + ' (' + fmtSize(f.size) + ')').join('\n'));
    }
    const validFiles = files.filter(f => f.size <= FILE_SIZE_LIMIT);
    if (!validFiles.length) return;

    const ok = confirm(
      '【ファイル送信の免責事項】\n\n' +
      '送信するファイルは接続中の相手に直接送られます。\n' +
      '・著作権物・違法なファイルの送信は禁止です。\n' +
      '・送信内容について当サイトは一切関知しません。\n' +
      '・送信者が全責任を負います。\n\n' +
      '・送信は遅いです。\n\n' +
      '同意して送信しますか？'
    );
    if (!ok) return;

    validFiles.forEach(sendFileSingle);
  }

  async function sendFileSingle(file) {
    if (!Object.keys(connections).length) return;
    const msgId = myId + '_' + (++msgIdCounter);
    const ts = Date.now();
    appendFileSending(msgId, file.name, file.size, file.type, ts);
    sentMsgs[msgId] = { readBy: new Set() };
    setFileSendStatus(msgId, 'preparing', 'SHA-256を計算中...');
    const arrayBuf = await file.arrayBuffer();
    const hashBuf  = await crypto.subtle.digest('SHA-256', arrayBuf);
    const sha256   = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,'0')).join('');
    broadcast({ type: 'file_meta', msgId, name: file.name, size: file.size, mime: file.type, sha256, from: myName, ts });
    setFileSendStatus(msgId, 'sending', '送信中...');
    const reader = new FileReader();
    reader.onload = e => {
      broadcast({ type: 'file', msgId, name: file.name, size: file.size, mime: file.type, sha256, from: myName, ts, data: e.target.result });
      setFileSendStatus(msgId, 'done', '✓ 送信完了');
    };
    reader.readAsDataURL(file);
  }

  async function handleFileReceived(conn, data) {
    if (!document.getElementById('p2p-fi-' + data.msgId)) appendFileIncoming(data);

    const ok = confirm(
      '【ファイル受信の免責事項】\n\n' +
      'ファイル名: ' + data.name + '\n' +
      'サイズ: ' + fmtSize(data.size) + '\n\n' +
      '・受信したファイルにはウイルスやマルウェアが含まれる可能性があります。(検査はありません)\n' +
      '・ファイルの内容について当サイトは一切責任を負いません。\n' +
      '・受信・ダウンロードは自己責任で行ってください。\n\n' +
      '・受信コンテンツが違法な場合は、あなたにも法的責任が降りかかる可能性があります。\n\n' +
      '受信してダウンロードリンクを表示しますか？'
    );
    if (!ok) {
      const wrap = $('p2p-fi-' + data.msgId);
      if (wrap) {
        wrap.className = 'p2p-file-card';
        wrap.style.animation = 'none';
        wrap.innerHTML =
          `<div class="p2p-file-icon">${fileIcon(data.mime)}</div>` +
          `<div class="p2p-file-info">` +
            `<div class="p2p-file-name">${escHtml(data.name)}</div>` +
            `<div class="p2p-file-size">${fmtSize(data.size)}</div>` +
            `<div class="p2p-file-status err">✗ 受信を拒否しました</div>` +
          `</div>`;
      }
      return;
    }

    const resp     = await fetch(data.data);
    const arrayBuf = await resp.arrayBuffer();
    const hashBuf  = await crypto.subtle.digest('SHA-256', arrayBuf);
    const sha256   = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,'0')).join('');
    if (sha256 !== data.sha256) { markFileRecvError(data.msgId, 'SHA-256が一致しません、破損しています'); return; }
    const blobUrl  = URL.createObjectURL(new Blob([arrayBuf], { type: data.mime }));
    markFileRecvDone(data.msgId, blobUrl, data);
    try { conn.send({ type: 'read', msgId: data.msgId }); } catch(e) {}
  }

  // ===== UI RENDER =====

  function replyQuoteHtml(data) {
    if (!data.replyTo) return '';
    const preview = (data.replyText || '').slice(0, 60) + ((data.replyText || '').length > 60 ? '…' : '');
    return `<div class="p2p-reply-quote">` +
      `<span class="p2p-reply-quote-from">${escHtml(data.replyFrom || '')}</span>` +
      `<span class="p2p-reply-quote-text">${escHtml(preview)}</span>` +
      `</div>`;
  }

  function actionButtonsHtml(msgId, isMe) {
    if (isMe) return ''; // 自分の発言にはボタン不要
    return `<div class="p2p-msg-actions">` +
      `<div class="p2p-reaction-wrap">` +
        `<button class="p2p-reaction-open-btn" data-msgid="${escHtml(msgId)}" title="リアクションを選ぶ">反応</button>` +
        `<div class="p2p-reaction-picker" id="p2p-picker-${escHtml(msgId)}" style="display:none">` +
          REACTION_EMOJIS.map(e =>
            `<button class="p2p-reaction-btn" data-msgid="${escHtml(msgId)}" data-emoji="${e}" title="${e}">${e}</button>`
          ).join('') +
        `</div>` +
      `</div>` +
      `<button class="p2p-reply-btn" data-msgid="${escHtml(msgId)}" title="この発言に返信">返信</button>` +
      `</div>`;
  }

  function appendMsg(data, isMe) {
    const el = document.createElement('div');
    el.className = 'p2p-msg ' + (isMe ? 'me' : 'other');
    el.id = 'p2p-msg-' + data.msgId;
    el.innerHTML =
      `<div class="p2p-sender">${isMe ? escHtml(myName) : escHtml(data.from)}</div>` +
      replyQuoteHtml(data) +
      `<div class="p2p-msg-text">${escHtml(data.text).replace(/\n/g, '<br>')}</div>` +
      `<div class="p2p-meta"><span>${fmtTime(data.ts)}</span>` +
      (isMe ? `<span id="p2p-tick-${data.msgId}">✓</span>` : '') +
      `</div>` +
      actionButtonsHtml(data.msgId, isMe);
    msgs().appendChild(el);
    scrollBottom();
    if (isMe) sentMsgs[data.msgId] = { readBy: new Set() };
  }

  function sysMsg(text) {
    const el = document.createElement('div');
    el.className = 'p2p-sys-msg';
    el.textContent = text;
    msgs().appendChild(el);
    scrollBottom();
  }

  function markRead(msgId, peerId) {
    if (!sentMsgs[msgId]) return;
    sentMsgs[msgId].readBy.add(peerId);
    if (sentMsgs[msgId].readBy.size >= Object.keys(connections).length) {
      const tick = $('p2p-tick-' + msgId);
      if (tick) { tick.textContent = '✓'; tick.title = '全員既読'; }
    }
  }

  function appendFileSending(msgId, name, size, mime, ts) {
    const el = document.createElement('div');
    el.className = 'p2p-msg me';
    el.id = 'p2p-msg-' + msgId;
    el.innerHTML =
      `<div class="p2p-sender">${escHtml(myName)}</div>` +
      `<div class="p2p-file-card" style="cursor:default">` +
        `<div class="p2p-file-icon">${fileIcon(mime)}</div>` +
        `<div class="p2p-file-info">` +
          `<div class="p2p-file-name">${escHtml(name)}</div>` +
          `<div class="p2p-file-size">${fmtSize(size)}</div>` +
          `<div class="p2p-progress-wrap"><div class="p2p-progress-bar" id="p2p-sp-${msgId}"></div></div>` +
          `<div class="p2p-file-status" id="p2p-ss-${msgId}">準備中...</div>` +
        `</div></div>` +
      `<div class="p2p-meta"><span>${fmtTime(ts)}</span><span id="p2p-tick-${msgId}">✓</span></div>`;
    msgs().appendChild(el);
    scrollBottom();
  }

  function setFileSendStatus(msgId, state, text) {
    const bar = $('p2p-sp-' + msgId), stat = $('p2p-ss-' + msgId);
    if (stat) { stat.textContent = text; stat.className = 'p2p-file-status' + (state === 'done' ? ' ok' : ''); }
    if (bar) {
      if (state === 'preparing') { bar.style.transition = 'none'; bar.style.width = '15%'; }
      if (state === 'sending')   { bar.style.transition = 'width 1s ease'; bar.style.width = '85%'; }
      if (state === 'done')      { bar.style.transition = 'width .3s ease'; bar.style.width = '100%'; }
    }
  }

  function appendFileIncoming(data) {
    if (document.getElementById('p2p-fi-' + data.msgId)) return;
    const el = document.createElement('div');
    el.className = 'p2p-msg other';
    el.id = 'p2p-msg-' + data.msgId;
    el.innerHTML =
      `<div class="p2p-sender">${escHtml(data.from)}</div>` +
      `<div class="p2p-file-incoming" id="p2p-fi-${data.msgId}">` +
        `<div class="p2p-file-icon">${fileIcon(data.mime)}</div>` +
        `<div class="p2p-file-info">` +
          `<div class="p2p-file-name">${escHtml(data.name)}</div>` +
          `<div class="p2p-file-size">${fmtSize(data.size)}</div>` +
          `<div class="p2p-progress-wrap"><div class="p2p-progress-bar" id="p2p-rp-${data.msgId}" style="width:0%;transition:width 1s ease"></div></div>` +
          `<div class="p2p-file-status" id="p2p-rs-${data.msgId}">📡 ファイル受信を待機中...</div>` +
        `</div></div>` +
      `<div class="p2p-meta"><span>${fmtTime(data.ts)}</span></div>`;
    msgs().appendChild(el);
    scrollBottom();
    setTimeout(() => {
      const b = $('p2p-rp-' + data.msgId), s = $('p2p-rs-' + data.msgId);
      if (b) b.style.width = '80%';
      if (s) s.textContent = '受信中...';
    }, 100);
  }

  function markFileRecvDone(msgId, url, data) {
    const bar = $('p2p-rp-' + msgId), stat = $('p2p-rs-' + msgId);
    if (bar) { bar.style.transition = 'width .2s'; bar.style.width = '100%'; }
    if (stat) stat.textContent = '検証中...';
    setTimeout(() => {
      const wrap = $('p2p-fi-' + msgId);
      if (!wrap) return;
      const isImage = data.mime && data.mime.startsWith('image/');
      if (isImage) {
        wrap.outerHTML =
          `<div class="p2p-image-card" id="p2p-fi-${msgId}">` +
            `<div class="p2p-image-card-header">` +
              `<span class="p2p-file-name">${escHtml(data.name)}</span>` +
              `<span class="p2p-file-size">${fmtSize(data.size)}</span>` +
            `</div>` +
            `<a href="${url}" download="${escHtml(data.name)}" class="p2p-image-link" title="クリックして保存">` +
              `<img class="p2p-inline-image" src="${url}" alt="${escHtml(data.name)}" />` +
            `</a>` +
            `<div class="p2p-file-status ok">✓ クリックして保存</div>` +
          `</div>`;
      } else {
        wrap.outerHTML =
          `<a class="p2p-file-card" href="${url}" download="${escHtml(data.name)}" id="p2p-fi-${msgId}">` +
            `<div class="p2p-file-icon">${fileIcon(data.mime)}</div>` +
            `<div class="p2p-file-info">` +
              `<div class="p2p-file-name">${escHtml(data.name)}</div>` +
              `<div class="p2p-file-size">${fmtSize(data.size)}</div>` +
              `<div class="p2p-file-status ok">✓ クリックしてダウンロード</div>` +
            `</div></a>`;
      }
    }, 300);
  }

  function markFileRecvError(msgId, reason) {
    const stat = $('p2p-rs-' + msgId), bar = $('p2p-rp-' + msgId);
    if (stat) { stat.textContent = '✗ ' + reason; stat.className = 'p2p-file-status err'; }
    if (bar) bar.style.width = '100%';
    toast('⚠ ' + reason);
  }

  // ===== PEERS UI =====

  function updatePeersUI() {
    const label = $('p2p-peers-label');
    if (!label) return;

    const names = Object.entries(roster)
      .filter(([id]) => id !== myId)
      .map(([, name]) => escHtml(name));

    label.innerHTML = names.length
      ? '接続中: ' + names.join('、')
      : '';

    const sendBtn = $('p2p-send-btn');
    if (sendBtn) sendBtn.disabled = !Object.keys(connections).length;
  }

  function updateTypingUI() {
    const el = $('p2p-typing');
    if (!el) return;
    if (!typingPeers.size) { el.textContent = ''; return; }
    const names = [...typingPeers].map(id => roster[id] || id.slice(0, 6)).join(', ');
    el.textContent = names + ' が入力中...';
  }

  // ===== VIEW STATE =====

  function showSetup() {
    setDisplay('p2p-agree', 'none');
    setDisplay('p2p-setup', '');
    $('p2p-chat') && $('p2p-chat').classList.remove('active');
  }

  function showChat() {
    setDisplay('p2p-agree', 'none');
    setDisplay('p2p-setup', 'none');
    $('p2p-chat') && $('p2p-chat').classList.add('active');
    const btn = $('p2p-disconnect-btn');
    if (btn) btn.textContent = isMaster ? '会話をクローズする' : '会話から離脱する';
  }

  function setDisplay(id, val) { const el = $(id); if (el) el.style.display = val; }

  function shareUrl() {
    return location.origin + location.pathname + '?connect=' + myId;
  }

  // ===== UTILITIES =====

  function msgs() { return $('p2p-messages'); }
  function scrollBottom() { const m = msgs(); if (m) m.scrollTop = m.scrollHeight; }

  function autoResize(el) {
    el.style.height = '';
    el.style.height = Math.min(el.scrollHeight, 100) + 'px';
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  }

  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function fileIcon(mime) {
    if (!mime) return '📄';
    if (mime.startsWith('image/')) return '🖼️';
    if (mime.startsWith('video/')) return '🎬';
    if (mime.startsWith('audio/')) return '🎵';
    if (mime.includes('pdf'))      return '📑';
    if (mime.includes('zip') || mime.includes('rar')) return '🗜️';
    return '📄';
  }

  function copyText(text, msg) {
    navigator.clipboard.writeText(text).then(() => toast(msg));
  }

  function toast(msg) {
    if (!document.getElementById('p2p-toast-style')) {
      const s = document.createElement('style');
      s.id = 'p2p-toast-style';
      s.textContent = '@keyframes p2p-toast-in{from{opacity:0;transform:translateX(-50%) translateY(8px)}}';
      document.head.appendChild(s);
    }
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);' +
      'padding:8px 16px;border:1px solid;z-index:99999;' +
      'background:inherit;color:inherit;font-size:0.85em;pointer-events:none;' +
      'animation:p2p-toast-in .2s ease';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
