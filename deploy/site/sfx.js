/* ============================================================
 *  sfx.js · 音频（Web Audio API 实时合成，无需任何外部音频文件）
 *  暴露全局 window.SFX
 *    SFX.play(name)            播放操作音（fold/check/call/raise/allin/deal/win/button）
 *    SFX.setSfxMuted(b)        操作音 开/关
 *    SFX.setMusicMuted(b)      背景音乐 开/关
 *    SFX.unlock()              用户手势内调用，强制解锁/恢复 AudioContext
 *    SFX.startMusic() / stopMusic()
 * ============================================================ */
(function () {
  let ctx = null;
  let sfxGain = null;     // 操作音主音量
  let musicGain = null;   // 背景音乐主音量
  let sfxMuted = false;
  let musicMuted = false;

  let musicTimer = null;  // 背景音乐循环定时器
  let musicRunning = false;

  // 整体主音量（觉得还轻可上调）
  const SFX_VOL = 0.55;     // 整体下调，避免吵
  const MUSIC_VOL = 0.28;   // 8bit 方波较刺耳，调低避免吵

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      sfxGain = ctx.createGain();
      sfxGain.gain.value = SFX_VOL;
      sfxGain.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = MUSIC_VOL;
      musicGain.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function unlock() {
    const c = ensure();
    if (c && c.state === 'suspended') c.resume();
    return c;
  }

  // ---------- 操作音 ----------
  function tone(opts) {
    const { freq = 440, type = 'sine', dur = 0.15, vol = 0.25, slideTo = null, when = 0 } = opts;
    const c = unlock();
    if (!c || sfxMuted) return;
    const t0 = c.currentTime + when;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(sfxGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.04);
  }

  function noise(opts) {
    const { dur = 0.08, vol = 0.18, when = 0 } = opts;
    const c = unlock();
    if (!c || sfxMuted) return;
    const t0 = c.currentTime + when;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(g); g.connect(sfxGain);
    src.start(t0); src.stop(t0 + dur);
  }

  const sounds = {
    // 弃牌：低沉下滑
    fold() { tone({ freq: 360, type: 'sawtooth', dur: 0.22, vol: 0.3, slideTo: 150 }); },
    // 过牌：轻短"滴"
    check() { tone({ freq: 560, type: 'sine', dur: 0.09, vol: 0.26 }); },
    // 跟注：两声清亮
    call() { tone({ freq: 460, type: 'triangle', dur: 0.12, vol: 0.32 }); tone({ freq: 700, type: 'triangle', dur: 0.11, vol: 0.22, when: 0.07 }); },
    // 加注：上行三连音
    raise() {
      tone({ freq: 460, type: 'square', dur: 0.10, vol: 0.26 });
      tone({ freq: 690, type: 'square', dur: 0.12, vol: 0.26, when: 0.10 });
      tone({ freq: 920, type: 'square', dur: 0.16, vol: 0.22, when: 0.22 });
    },
    // 全下：低频轰鸣 + 冲击噪声
    allin() { tone({ freq: 210, type: 'sawtooth', dur: 0.55, vol: 0.36, slideTo: 80 }); noise({ dur: 0.34, vol: 0.22 }); },
    // 发牌：轻轻"咔"
    deal() { noise({ dur: 0.05, vol: 0.2 }); },
    // 获胜：上行大三和弦琶音
    win() { [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.26, vol: 0.32, when: i * 0.11 })); },
    // 按钮点击：极短方波
    button() { tone({ freq: 340, type: 'square', dur: 0.05, vol: 0.16 }); },
    // 淘汰出局：低沉下行 + 闷响
    out() { tone({ freq: 320, type: 'sawtooth', dur: 0.5, vol: 0.34, slideTo: 70 }); noise({ dur: 0.28, vol: 0.16 }); },
    // 收筹码入袋：清脆两连音 + 轻微噪声（底池飞向胜者时）
    collect() { tone({ freq: 660, type: 'triangle', dur: 0.08, vol: 0.28 }); tone({ freq: 990, type: 'triangle', dur: 0.10, vol: 0.24, when: 0.07 }); noise({ dur: 0.05, vol: 0.12, when: 0.02 }); },
  };

  // ---------- 背景音乐（街机/赛博 chiptune）----------
  const BPM = 128;
  const STEP = 60 / BPM / 4;        // 十六分音符时长（秒）
  let step = 0;

  // 和弦进行（4 小节循环，赛博 synthwave）：Am – F – C – G
  const CHORDS = [
    [220.00, 261.63, 329.63],  // Am: A C E
    [174.61, 220.00, 261.63],  // F : F A C
    [261.63, 329.63, 392.00],  // C : C E G
    [196.00, 246.94, 293.66],  // G : G B D
  ];
  const ARP_SEQ = [0, 1, 2, 1];
  // 主旋律（64 步 = 4 小节，A 小调跳跃切分；null 为休止）
  const N = null;
  const LEAD = [
    440.00, N,      523.25, N,      659.25, N,      523.25, 440.00,
    493.88, N,      587.33, N,      493.88, N,      440.00, N,
    349.23, N,      440.00, N,      523.25, N,      440.00, 349.23,
    392.00, N,      493.88, N,      392.00, N,      349.23, N,
    523.25, N,      659.25, N,      783.99, N,      659.25, 523.25,
    587.33, N,      698.46, N,      587.33, N,      523.25, N,
    392.00, 392.00, 493.88, N,      587.33, N,      493.88, 392.00,
    440.00, N,      523.25, N,      440.00, N,      329.63, N,
  ];

  function chipNote(freq, t, dur, type, vol) {
    const c = ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(musicGain);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function hatTick(t, vol) {
    const c = ctx;
    const len = Math.max(1, Math.floor(c.sampleRate * 0.03));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    src.connect(g); g.connect(musicGain);
    src.start(t); src.stop(t + 0.03);
  }

  function scheduleStep() {
    const c = ensure();
    if (!c || musicMuted) { musicRunning = false; return; }
    const t = c.currentTime + 0.03;
    const bar = Math.floor(step / 16) % CHORDS.length;   // 当前小节
    // 贝斯：每八分音符（2 步）奏根音，反拍偶尔五度
    if (step % 2 === 0) {
      const note = (step % 8 === 4) ? CHORDS[bar][2] : CHORDS[bar][0];
      chipNote(note, t, STEP * 1.8, 'square', 0.13);
    }
    // 琶音闪烁层（赛博感）：每八分音符三和弦上行
    if (step % 2 === 0) {
      const chord = CHORDS[bar];
      const idx = ARP_SEQ[(step / 2) % ARP_SEQ.length];
      chipNote(chord[idx] * 2, t, STEP * 1.4, 'square', 0.035);
    }
    // 主旋律：每八分音符
    const ln = LEAD[step % LEAD.length];
    if (ln != null) chipNote(ln, t, STEP * 1.5, 'square', 0.075);
    // 轻 hi-hat：每八分音符
    if (step % 2 === 0) hatTick(t, 0.02);
    step++;
    musicTimer = setTimeout(scheduleStep, STEP * 1000);
  }

  function startMusic() {
    if (musicRunning) return;
    const c = ensure();
    if (!c) return; // 还没用户手势，等 unlock 后再 start
    if (musicMuted) return;
    musicRunning = true;
    step = 0;
    scheduleStep();
  }
  function stopMusic() {
    musicRunning = false;
    if (musicTimer) { clearTimeout(musicTimer); musicTimer = null; }
  }

  window.SFX = {
    play(name) { if (sounds[name]) sounds[name](); },
    setSfxMuted(m) { sfxMuted = m; },
    setMusicMuted(m) { musicMuted = m; if (m) stopMusic(); else startMusic(); },
    isSfxMuted() { return sfxMuted; },
    isMusicMuted() { return musicMuted; },
    unlock() { unlock(); if (!musicMuted) startMusic(); },
    startMusic() { startMusic(); },
    stopMusic() { stopMusic(); },
  };
})();
