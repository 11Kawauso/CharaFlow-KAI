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
    mode:'fit', size:70, speed:3, font:'gothic', bold:true, fg:'#ffe600', bg:'#000000', flip:false, land:true,
    phrases:['ごはんできたよー！','お風呂わいたよ','電話だよ','ちょっと出かけてくるね','何か飲む？','もう一回言うね'],
    history:[]
  };
  const KEY = 'oomoji-v1';
  let S = {...DEFAULTS};
  try { const raw = localStorage.getItem(KEY); if (raw) S = {...DEFAULTS, ...JSON.parse(raw)}; } catch(e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch(e) {} };

  const $ = id => document.getElementById(id);
  const input = $('input'), sample = $('sample'), stage = $('stage'), board = $('board'),
        fitbox = $('fitbox'), txt = $('txt');

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
  $('speed').oninput = e => { S.speed = +e.target.value; save(); syncUI(); };
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
    $('speed').value = S.speed; $('speedVal').textContent = ['','ゆっくり','やや遅い','ふつう','やや速い','速い'][S.speed];
    $('speedField').hidden = S.mode !== 'scroll';
    $('bold').checked = S.bold; $('flip').checked = S.flip; $('land').checked = S.land;
    $('stLand').textContent = S.land ? '縦にする' : '横にする';
    $('fg').value = S.fg; $('bg').value = S.bg;
    applyLook(sample);
    sample.textContent = input.value.trim() || '見本';
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
      b.append(p);
      const x = document.createElement('span'); x.className = 'x'; x.textContent = '×'; b.append(x);
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
      b.type = 'button'; b.className = 'chip'; b.textContent = p.length > 18 ? p.slice(0,18) + '…' : p;
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
    txt.textContent = S.mode === 'scroll' ? text.replace(/\s*\n\s*/g, '　') : text;
    if (anim) { anim.cancel(); anim = null; }
    txt.style.transform = '';
    const W = fitbox.clientWidth, H = fitbox.clientHeight;
    if (!W || !H) return;

    if (S.mode === 'scroll') {
      const fs = Math.max(24, H * S.size / 100 * 0.8);
      txt.style.fontSize = fs + 'px';
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
      let lo = 12, hi = Math.max(16, H * S.size / 100), best = lo;
      for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2;
        txt.style.fontSize = mid + 'px';
        if (txt.scrollHeight <= H && txt.scrollWidth <= W) { best = mid; lo = mid; } else { hi = mid; }
      }
      txt.style.fontSize = Math.floor(best) + 'px';
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
  input.addEventListener('input', () => { sample.textContent = input.value.trim() || '見本'; if (!stage.hidden) render(); });
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
        sample.textContent = input.value || '見本';
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

  renderChips(); syncUI();
})();
