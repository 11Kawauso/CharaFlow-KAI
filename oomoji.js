(() => {
  const FONTS = {
    gothic: '"BIZ UDPGothic","Hiragino Sans","Noto Sans JP",sans-serif',
    mincho: '"BIZ UDPMincho","Hiragino Mincho ProN","Noto Serif JP",serif',
    maru:   '"M PLUS Rounded 1c","Hiragino Maru Gothic ProN","Noto Sans JP",sans-serif'
  };
  const PRESETS = [
    {bg:'#000000', fg:'#ffe600'}, {bg:'#000000', fg:'#ffffff'},
    {bg:'#ffffff', fg:'#111111'}, {bg:'#0b2a4a', fg:'#ffffff'}
  ];
  const DEFAULTS = {
    mode:'fit', size:70, picSize:80, speed:3, font:'gothic', bold:true, fg:'#ffe600', bg:'#000000', flip:false, land:true,
    phrases:['ごはんできたよー！','お風呂わいたよ','電話だよ','ちょっと出かけてくるね','何か飲む？','もう一回言うね'],
    history:[], pics:[], picSeq:0
  };
  const KEY = 'oomoji-v1';
  let S = {...DEFAULTS};
  try { const raw = localStorage.getItem(KEY); if (raw) S = {...DEFAULTS, ...JSON.parse(raw)}; } catch(e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch(e) {} };

  const $ = id => document.getElementById(id);
  const input = $('input'), sample = $('sample'), stage = $('stage'), board = $('board'),
        fitbox = $('fitbox'), txt = $('txt');

  /* ---------- 画像 ---------- */
  // 画像本体は IndexedDB（localStorage には入りきらない）、並び順と番号だけ S に持つ
  const PICS = new Map();   // id → {id, url, w, h}
  const TOKEN = /[\[［]画像(\d+)[\]］]/g;
  const MAX_SIDE = 1600;
  const idb = new Promise(res => {
    try {
      const r = indexedDB.open('oomoji-pics', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('pics');
      r.onsuccess = () => res(r.result); r.onerror = () => res(null);
    } catch(e) { res(null); }
  });
  async function tx(mode, fn) {
    const db = await idb; if (!db) return;
    return new Promise(res => {
      try {
        const t = db.transaction('pics', mode), q = fn(t.objectStore('pics'));
        t.oncomplete = () => res(q.result); t.onerror = t.onabort = () => res();
      } catch(e) { res(); }
    });
  }
  // スマホの写真はそのままだと重いので、長い辺を MAX_SIDE までに縮める
  async function shrink(file) {
    let bmp; try { bmp = await createImageBitmap(file); } catch(e) { return null; }
    const w = bmp.width, h = bmp.height, k = Math.min(1, MAX_SIDE / Math.max(w, h));
    if (file.type === 'image/gif' || (k === 1 && file.size < 1.5e6)) { bmp.close(); return {blob:file, w, h}; }
    const c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
    const blob = await new Promise(r => c.toBlob(r, file.type === 'image/png' ? 'image/png' : 'image/jpeg', .88));
    return blob ? {blob, w:c.width, h:c.height} : {blob:file, w, h};
  }
  function addPic(id, rec) { PICS.set(id, {id, url:URL.createObjectURL(rec.blob), w:rec.w, h:rec.h}); }

  // 文を「文字」と「画像」に分ける。消した画像の［画像N］は表示しない
  function parse(text) {
    const out = []; let last = 0;
    for (const m of text.matchAll(TOKEN)) {
      if (m.index > last) out.push(text.slice(last, m.index));
      const p = PICS.get(+m[1]); if (p) out.push(p);
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }
  // el の中身を文字と画像で描く。画像だけの文なら el に solo を付ける
  function paint(el, text, max = Infinity) {
    const parts = parse(text);
    const solo = parts.filter(p => typeof p !== 'string').length === 1 && parts.every(p => typeof p !== 'string' || !p.trim());
    el.classList.toggle('solo', solo);
    el.textContent = '';
    let n = 0;
    for (const p of parts) {
      if (typeof p === 'string') {
        if (solo) continue;
        if (n + p.length > max) { el.append(p.slice(0, max - n) + '…'); return; }
        el.append(p); n += p.length;
      } else {
        if (n >= max) { el.append('…'); return; }
        const img = new Image(p.w, p.h); img.src = p.url; img.alt = '画像' + p.id;
        el.append(img); n += 2;
      }
    }
  }
  const paintSample = () => paint(sample, input.value.trim() || '見本');

  // 入力欄のカーソル位置を覚えておき、画像をそこへ差し込む（null なら末尾）
  let caret = null;
  ['input','keyup','click','select'].forEach(ev => input.addEventListener(ev, () => { caret = input.selectionStart; }));
  function insertPic(id) {
    const v = input.value, s = '［画像' + id + '］', a = Math.min(caret ?? v.length, v.length);
    input.value = v.slice(0, a) + s + v.slice(a);
    caret = a + s.length;
    paintSample();
  }

  let picEditing = false;
  function renderPics() {
    const g = $('pics'); g.innerHTML = '';
    g.classList.toggle('editing', picEditing);
    S.pics.forEach(id => {
      const p = PICS.get(id); if (!p) return;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'tile';
      const img = new Image(p.w, p.h); img.src = p.url; img.alt = '';
      const x = document.createElement('span'); x.className = 'x'; x.textContent = '×';
      b.append(img, '画像' + id, x);
      b.onclick = () => {
        if (!picEditing) { insertPic(id); return; }
        S.pics = S.pics.filter(v => v !== id); save();
        URL.revokeObjectURL(p.url); PICS.delete(id);
        tx('readwrite', st => st.delete(id));
        if (!S.pics.length) picEditing = false;
        renderPics(); renderChips(); syncUI();
      };
      g.appendChild(b);
    });
    if (!picEditing) {
      const add = document.createElement('button');
      add.type = 'button'; add.className = 'tile add';
      const plus = document.createElement('b'); plus.textContent = '＋';
      add.append(plus, '画像を追加');
      add.onclick = () => $('picFile').click();
      g.appendChild(add);
    }
    $('editPics').hidden = !S.pics.length;
    $('editPics').textContent = picEditing ? '完了' : '編集';
  }
  $('editPics').onclick = () => { picEditing = !picEditing; renderPics(); };
  $('picFile').onchange = async e => {
    for (const f of e.target.files) {
      const rec = await shrink(f); if (!rec) continue;
      const id = ++S.picSeq;
      addPic(id, rec); S.pics.push(id);
      await tx('readwrite', st => st.put(rec, id));
    }
    e.target.value = ''; save(); renderPics(); syncUI();
  };

  /* ---------- 設定 UI ---------- */
  function segBind(segId, key) {
    const seg = $(segId);
    seg.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      S[key] = b.dataset.v; save(); syncUI();
    });
  }
  segBind('modeSeg','mode'); segBind('fontSeg','font');

  const colorSeg = $('colorSeg');
  PRESETS.forEach((p,i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sw'; b.textContent = 'あ';
    b.style.background = p.bg; b.style.color = p.fg; b.dataset.i = i;
    b.setAttribute('aria-label', '配色 ' + (i+1));
    b.onclick = () => { S.bg = p.bg; S.fg = p.fg; save(); syncUI(); };
    colorSeg.appendChild(b);
  });

  $('size').oninput = e => { S.size = +e.target.value; save(); syncUI(); };
  $('picSize').oninput = e => { S.picSize = +e.target.value; save(); syncUI(); };
  $('speed').oninput =e => { S.speed = +e.target.value; save(); syncUI(); };
  $('bold').onchange = e => { S.bold = e.target.checked; save(); syncUI(); };
  $('flip').onchange = e => { S.flip = e.target.checked; save(); syncUI(); };
  $('land').onchange = e => { S.land = e.target.checked; save(); syncUI(); };
  $('fg').oninput = e => { S.fg = e.target.value; save(); syncUI(); };
  $('bg').oninput = e => { S.bg = e.target.value; save(); syncUI(); };

  function applyLook(el) {
    el.style.background = S.bg; el.style.color = S.fg;
    el.style.fontFamily = FONTS[S.font]; el.style.fontWeight = S.bold ? (S.font === 'maru' ? 800 : 700) : (S.font === 'maru' ? 500 : 400);
  }

  function syncUI() {
    document.querySelectorAll('#modeSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === S.mode));
    document.querySelectorAll('#fontSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === S.font));
    document.querySelectorAll('#colorSeg .sw').forEach(b => {
      const p = PRESETS[b.dataset.i]; b.setAttribute('aria-pressed', p.bg === S.bg && p.fg === S.fg);
    });
    $('size').value = S.size; $('sizeVal').textContent = S.size + '%';
    $('picSize').value = S.picSize; $('picSizeVal').textContent = S.picSize + '%';
    $('picSizeField').hidden = !S.pics.length;
    // 見本でも、文字と画像の大きさの比を本番と同じにする
    sample.style.setProperty('--pic', S.picSize / S.size + 'em');
    sample.style.setProperty('--pic-solo', S.picSize * 2.5 + 'px');
    $('speed').value = S.speed; $('speedVal').textContent = ['','ゆっくり','やや遅い','ふつう','やや速い','速い'][S.speed];
    $('speedField').hidden = S.mode !== 'scroll';
    $('bold').checked = S.bold; $('flip').checked = S.flip; $('land').checked = S.land;
    $('stLand').textContent = S.land ? '縦にする' : '横にする';
    $('fg').value = S.fg; $('bg').value = S.bg;
    applyLook(sample);
    paintSample();
    $('stMode').textContent = S.mode === 'scroll' ? '全文表示' : '流す';
    $('stFlip').classList.toggle('on', S.flip);
    if (!stage.hidden) render();
  }

  /* ---------- 定型文と履歴 ---------- */
  let editing = false;
  function renderChips() {
    const wrap = $('phrases'); wrap.innerHTML = '';
    wrap.classList.toggle('editing', editing);
    S.phrases.forEach((p, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip';
      const t = document.createElement('span'); paint(t, p);
      const x = document.createElement('span'); x.className = 'x'; x.textContent = '×'; b.append(t, x);
      b.onclick = () => {
        if (editing) { S.phrases.splice(i,1); save(); renderChips(); }
        else { input.value = p; show(); }
      };
      wrap.appendChild(b);
    });
    $('editPhrase').textContent = editing ? '完了' : '編集';

    const h = $('history'); h.innerHTML = '';
    $('histSec').hidden = !S.history.length;
    S.history.forEach(p => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip';
      const t = document.createElement('span'); paint(t, p, 18); b.append(t);
      b.onclick = () => { input.value = p; show(); };
      h.appendChild(b);
    });
  }
  $('addPhrase').onclick = () => {
    const v = input.value.trim(); if (!v || S.phrases.includes(v)) return;
    S.phrases.push(v); save(); renderChips();
  };
  $('editPhrase').onclick = () => { editing = !editing; renderChips(); };

  /* ---------- 表示 ---------- */
  let anim = null, wakeLock = null;

  function render() {
    applyLook(stage);
    // 横向き設定で、画面がまだ縦長なら90度回して表示
    stage.classList.toggle('rot', S.land && innerHeight > innerWidth);
    board.classList.toggle('flip', S.flip);
    board.classList.toggle('scroll', S.mode === 'scroll');
    const text = input.value.trim() || ' ';
    paint(txt, S.mode === 'scroll' ? text.replace(/\s*\n\s*/g, '　') : text);
    if (anim) { anim.cancel(); anim = null; }
    txt.style.transform = '';
    const W = fitbox.clientWidth, H = fitbox.clientHeight;
    if (!W || !H) return;

    if (S.mode === 'scroll') {
      const fs = Math.max(24, H * S.size / 100 * 0.8);
      txt.style.fontSize = fs + 'px';
      txt.style.setProperty('--pic', H * S.picSize / 100 * 0.8 + 'px');
      txt.style.marginTop = (-txt.offsetHeight / 2) + 'px';
      const w = txt.scrollWidth;
      const pxPerSec = W * (0.12 + S.speed * 0.07);
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) { txt.style.transform = 'translateX(0)'; return; }
      anim = txt.animate(
        [{transform:`translateX(${W}px)`},{transform:`translateX(${-w}px)`}],
        {duration: (W + w) / pxPerSec * 1000, iterations: Infinity}
      );
    } else {
      txt.style.marginTop = '';
      // 文字と画像は別々の大きさ設定。両方を同じ割合 k で縮め、画面に収まる一番大きい k を探す
      const fMax = Math.max(16, H * S.size / 100), pMax = H * S.picSize / 100;
      const scale = k => {
        txt.style.fontSize = Math.max(12, Math.floor(fMax * k)) + 'px';
        txt.style.setProperty('--pic', Math.floor(pMax * k) + 'px');
      };
      let lo = 0, hi = 1, best = Math.min(1, 12 / fMax);
      for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2;
        scale(mid);
        if (txt.scrollHeight <= H && txt.scrollWidth <= W) { best = mid; lo = mid; } else { hi = mid; }
      }
      scale(best);
    }
  }

  async function show() {
    const v = input.value.trim(); if (!v) { input.focus(); return; }
    S.history = [v, ...S.history.filter(h => h !== v)].slice(0, 8); save(); renderChips();
    syncUI();
    stage.hidden = false;
    try { await document.documentElement.requestFullscreen?.(); } catch(e) {}
    if (S.land) { try { await screen.orientation?.lock?.('landscape'); } catch(e) {} }
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch(e) {}
    requestAnimationFrame(render);
  }
  async function hide() {
    stage.hidden = true;
    if (anim) { anim.cancel(); anim = null; }
    stage.classList.remove('rot');
    try { screen.orientation?.unlock?.(); } catch(e) {}
    try { if (document.fullscreenElement) await document.exitFullscreen(); } catch(e) {}
    try { await wakeLock?.release(); } catch(e) {} wakeLock = null;
  }

  $('showBtn').onclick = show;
  $('stClose').onclick = hide;
  board.onclick = hide;
  $('stLand').onclick = async () => {
    S.land = !S.land; save();
    try { S.land ? await screen.orientation?.lock?.('landscape') : screen.orientation?.unlock?.(); } catch(e) {}
    syncUI();
  };
  $('stFlip').onclick = () => { S.flip = !S.flip; save(); syncUI(); };
  $('stMode').onclick = () => { S.mode = S.mode === 'scroll' ? 'fit' : 'scroll'; save(); syncUI(); };
  $('clearBtn').onclick = () => { input.value = ''; caret = null; paintSample(); };
  input.addEventListener('input', () => { paintSample(); if (!stage.hidden) render(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); show(); }
  });
  addEventListener('resize', () => { if (!stage.hidden) render(); });
  document.addEventListener('visibilitychange', async () => {
    if (!stage.hidden && document.visibilityState === 'visible') {
      try { wakeLock = await navigator.wakeLock?.request('screen'); } catch(e) {}
    }
  });

  /* ---------- 音声入力 ---------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, listening = false, base = '';
  const hint = $('micHint');

  function setListening(on) {
    listening = on;
    $('micBtn').classList.toggle('on', on); $('micBtn').setAttribute('aria-pressed', on);
    $('micLabel').textContent = on ? '止める' : '話す';
    $('stMic').classList.toggle('on', on); $('stMic').textContent = on ? '止める' : '話す';
  }
  function micUnavailable() {
    hint.classList.add('warn');
    hint.textContent = 'ここではマイクが使えません。スマホのキーボードのマイクボタンで話すと、入力欄に文字が入ります。';
    input.focus();
  }
  function toggleMic() {
    if (listening) { rec?.stop(); return; }
    if (!SR) { micUnavailable(); return; }
    try {
      rec = new SR();
      rec.lang = 'ja-JP'; rec.interimResults = true; rec.continuous = true;
      base = '';
      let finals = '';
      rec.onresult = e => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finals += t; else interim += t;
        }
        input.value = base + finals + interim;
        caret = null; paintSample();
        if (!stage.hidden) render();
      };
      rec.onerror = e => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') micUnavailable();
      };
      rec.onend = () => setListening(false);
      rec.start();
      setListening(true);
      hint.classList.remove('warn');
      hint.textContent = '聞き取り中…話した言葉がそのまま入ります。';
    } catch (err) { setListening(false); micUnavailable(); }
  }
  $('micBtn').onclick = toggleMic;
  $('stMic').onclick = toggleMic;

  renderChips(); renderPics(); syncUI();
  // 保存してある画像を読み込んでから、画像入りの表示を描き直す
  (async () => {
    for (const id of S.pics) {
      const rec = await tx('readonly', st => st.get(id));
      if (rec) addPic(id, rec);
    }
    S.pics = S.pics.filter(id => PICS.has(id)); save();
    renderChips(); renderPics(); syncUI();
  })();
})();
