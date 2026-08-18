/* ============================================================
 *  德州扑克 · 界面与交互
 *  依赖 engine.js 暴露的全局：PokerGame / rankLabel / SUIT_SYMBOL /
 *  SUIT_COLOR / SUITS / evaluate7 / compareScore
 * ============================================================ */
(function () {
  // 可调参数（由开始界面设置）
  let NUM_PLAYERS = 4;
  let START_STACK = 1000;
  const BIG_BLIND = 20;
  let AGGRESSION = 0.5;
  let winRateEnabled = false;

  let game = null;
  const AI_DELAY = 850;
  const WR_ITERS = 900;
  let prevCommLen = 0;    // 上一帧公共牌数量（用于翻牌逐张动画）
  let revealing = false;  // 摊牌亮牌动画是否进行中
  let sfxOn = true;       // 操作音开关
  let musicOn = true;     // 背景音乐开关
  let winPlayed = false;  // 本手是否已播放获胜音效
  let awardScheduled = false; // 本手是否已安排底池派彩飞行动画
  let awardedAnim = false;    // 本手派彩飞行动画是否已完成（决定底池显示 ¥0）

  const el = {
    seats: document.getElementById('seats'),
    pot: document.getElementById('pot'),
    board: document.getElementById('board'),
    burns: document.getElementById('burns'),
    stageInfo: document.getElementById('stageInfo'),
    message: document.getElementById('message'),
    handCount: document.getElementById('handCount'),
    log: document.getElementById('log'),
    controls: document.getElementById('controls'),
    btnFold: document.getElementById('btnFold'),
    btnCheck: document.getElementById('btnCheck'),
    btnCall: document.getElementById('btnCall'),
    btnAllIn: document.getElementById('btnAllIn'),
    btnR50: document.getElementById('btnR50'),
    btnR66: document.getElementById('btnR66'),
    btnR100: document.getElementById('btnR100'),
    grpRight: document.querySelector('.grp-right'),
    btnNext: document.getElementById('btnNext'),
    btnNewGame: document.getElementById('btnNewGame'),
    btnWinRate: document.getElementById('btnWinRate'),
    btnMusic: document.getElementById('btnMusic'),
    btnSfx: document.getElementById('btnSfx'),
    raiseWrap: document.getElementById('raiseWrap'),
    raiseRange: document.getElementById('raiseRange'),
    btnRaiseMinus: document.getElementById('btnRaiseMinus'),
    btnRaisePlus: document.getElementById('btnRaisePlus'),
    startScreen: document.getElementById('startScreen'),
    aggSlider: document.getElementById('aggSlider'),
    aggLabel: document.getElementById('aggLabel'),
    btnStart: document.getElementById('btnStart'),
  };

  const STAGE_TEXT = { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌', showdown: '摊牌' };

  const seatEls = [];

  // ---- 开始界面 ----
  function showStartScreen() {
    document.querySelectorAll('#playerCount button').forEach(b => {
      b.classList.toggle('on', +b.dataset.n === NUM_PLAYERS);
    });
    el.aggSlider.value = Math.round(AGGRESSION * 100);
    updateAggLabel();
    el.startScreen.classList.remove('hide');
  }
  function hideStartScreen() { el.startScreen.classList.add('hide'); }

  document.querySelectorAll('#playerCount button').forEach(b => {
    b.addEventListener('click', () => {
      NUM_PLAYERS = +b.dataset.n;
      document.querySelectorAll('#playerCount button').forEach(x => x.classList.toggle('on', x === b));
    });
  });
  document.querySelectorAll('#stackCount button').forEach(b => {
    b.addEventListener('click', () => {
      START_STACK = +b.dataset.s;
      document.querySelectorAll('#stackCount button').forEach(x => x.classList.toggle('on', x === b));
    });
  });
  el.aggSlider.addEventListener('input', () => { AGGRESSION = +el.aggSlider.value / 100; updateAggLabel(); });
  function updateAggLabel() {
    const v = +el.aggSlider.value;
    el.aggLabel.textContent = v < 33 ? '保守' : (v > 66 ? '激进' : '均衡');
  }
  el.btnStart.addEventListener('click', () => { SFX.unlock(); if (sfxOn) SFX.play('button'); startGame(); });
  el.btnNewGame.addEventListener('click', showStartScreen);
  el.btnMusic.addEventListener('click', () => {
    musicOn = !musicOn;
    SFX.setMusicMuted(!musicOn);
    el.btnMusic.textContent = musicOn ? '🎵 音乐' : '🎵 关';
    SFX.unlock();
  });
  el.btnSfx.addEventListener('click', () => {
    sfxOn = !sfxOn;
    SFX.setSfxMuted(!sfxOn);
    el.btnSfx.textContent = sfxOn ? '🔊 音效' : '🔇 静音';
    SFX.unlock();
    if (sfxOn) SFX.play('button');
  });
  // 首次任意交互强制解锁音频（部分浏览器策略需要）
  window.addEventListener('pointerdown', () => SFX.unlock(), { once: true });

  function startGame() {
    SFX.unlock();            // 用户手势触发，解锁音频
    SFX.setSfxMuted(!sfxOn);
    if (musicOn) SFX.startMusic();
    hideStartScreen();
    hideVictory();
    game = new PokerGame({ numPlayers: NUM_PLAYERS, startingStack: START_STACK, bigBlind: BIG_BLIND, aggression: AGGRESSION });
    buildSeats();
    el.controls.style.display = '';
    newHand();
  }

  // ---- 座位 ----
  function buildSeats() {
    el.seats.innerHTML = '';
    seatEls.length = 0;
    const n = game.players.length;
    game.players.forEach((p, i) => {
      const seat = document.createElement('div');
      seat.className = 'seat';
      seat.innerHTML = `
        <div class="action"></div>
        <div class="name"><span class="dealer-btn" style="display:none">D</span><span class="nm"></span></div>
        <div class="chips">筹码 <b class="stk"></b></div>
        <div class="bet" style="display:none"></div>
        <div class="cards"></div>
        <div class="peek-hint"></div>
        <div class="winrate"></div>
        <div class="status"></div>`;
      // 围绕牌桌均匀分布，玩家(0)固定在底部
      const angle = Math.PI / 2 + i * (2 * Math.PI / n);
      seat.style.left = (50 + 40 * Math.cos(angle)) + '%';
      seat.style.top = (50 + 37 * Math.sin(angle)) + '%';
      el.seats.appendChild(seat);
      seatEls.push(seat);
    });
  }

  function makeCard(card, opts = {}) {
    const { faceUp = true, mini = false, win = false } = opts;
    const div = document.createElement('div');
    if (!faceUp) { div.className = 'card back' + (mini ? ' mini' : ''); return div; }
    const color = SUIT_COLOR[card.suit];
    div.className = 'card ' + color + (mini ? ' mini' : '') + (win ? ' win' : '');
    div.innerHTML = `<span class="r">${rankLabel(card.rank)}</span><span class="s">${SUIT_SYMBOL[card.suit]}</span>`;
    return div;
  }

  function log(text, isMe) {
    const div = document.createElement('div');
    div.innerHTML = text;
    if (isMe) div.classList.add('me');
    el.log.appendChild(div);
    el.log.scrollTop = el.log.scrollHeight;
  }

  // ---- 渲染 ----
  function render() {
    el.handCount.textContent = '第 ' + game.handNumber + ' 手';
    if (game.handOver && game.lastResults && !awardedAnim) {
      // 派彩动画完成前，底池仍显示发奖前总额（各池金额之和）
      const total = game.lastResults.reduce((s, r) => s + (r.pot || 0), 0);
      el.pot.innerHTML = '底池 <b>¥' + total + '</b>';
    } else {
      el.pot.innerHTML = '底池 <b>¥' + game.pot + '</b>';
    }
    el.stageInfo.textContent = STAGE_TEXT[game.stage] || '';

    el.board.innerHTML = '';
    const comm = game.community;
    const newStart = comm.length < prevCommLen ? 0 : prevCommLen;
    comm.forEach((c, idx) => {
      const cardEl = makeCard(c);
      if (idx >= newStart) {
        cardEl.classList.add('flip-in');
        cardEl.style.animationDelay = ((idx - newStart) * 160) + 'ms';
        if (sfxOn) SFX.play('deal');
      }
      el.board.appendChild(cardEl);
    });
    prevCommLen = comm.length;

    // 烧牌堆（面朝下）
    el.burns.innerHTML = '';
    game.burns.forEach(() => {
      const b = document.createElement('div');
      b.className = 'card back mini burn';
      el.burns.appendChild(b);
    });

    const winners = new Set();
    if (game.handOver && game.lastResults) {
      game.lastResults.forEach(r => r.winners.forEach(w => winners.add(w.id)));
    }

    game.players.forEach((p, i) => {
      const seat = seatEls[i];
      if (p.busted) {
        // 金钱清零：播放"移出场外"动效后再隐藏
        if (!p._elimAnim) {
          p._elimAnim = true;
          seat.classList.add('eliminated');
          const st = seat.querySelector('.status');           if (st) st.textContent = '出局';
          if (sfxOn && !game.gameOver) SFX.play('out');
          toast(p.name + ' 被淘汰！');
          setTimeout(() => { p._elimDone = true; seat.style.display = 'none'; }, 760);
        } else if (p._elimDone) {
          seat.style.display = 'none';
        }
        return;
      }
      seat.style.display = '';
      seat.classList.toggle('active', !game.handOver && game.toAct === i);
      seat.classList.toggle('folded', p.folded);
      seat.classList.toggle('winner', winners.has(p.id));

      seat.querySelector('.nm').textContent = p.name;
      seat.querySelector('.stk').textContent = '¥' + p.stack;

      seat.querySelector('.dealer-btn').style.display = p.isDealer ? 'inline-flex' : 'none';

      const bet = seat.querySelector('.bet');
      if (p.bet > 0) { bet.style.display = 'inline-block'; bet.textContent = '下注 ¥' + p.bet; }
      else bet.style.display = 'none';

      // 下注额增加 → 筹码飞向底池（覆盖盲注/跟注/加注/全下）
      const prevBet = p._shownBet || 0;
      if (p.bet > prevBet && game.pot > 0) flyChips(i, p.bet - prevBet);
      p._shownBet = p.bet;

      const status = seat.querySelector('.status');
      if (game.handOver && p.folded) status.textContent = '已弃牌';
      else if (game.handOver && game.stage === 'showdown' && p.bestHand) status.textContent = handLabel(p.bestHand);
      else if (p.allIn) status.textContent = 'All In';
      else status.textContent = '';

      // 角色动作气泡
      const actEl = seat.querySelector('.action');
      if (p.lastAction) {
        actEl.textContent = p.lastAction;
        actEl.className = 'action show ' + (p.lastActionType || '');
        if (p._actionAnim) {
          actEl.classList.add('pop');
          seat.classList.add('acted');
          setTimeout(() => seat.classList.remove('acted'), 650);
          p._actionAnim = false;
        }
      } else {
        actEl.className = 'action';
      }

      // 胜率（仅玩家，且开启时）
      const wrEl = seat.querySelector('.winrate');
      if (p.isHuman && winRateEnabled && !p.folded && !game.handOver) {
        wrEl.textContent = '🎯 胜率 ' + (p.winRate != null ? p.winRate + '%' : '估算中…');
        wrEl.classList.add('show');
      } else {
        wrEl.classList.remove('show');
      }

      const cardsBox = seat.querySelector('.cards');
      cardsBox.innerHTML = '';
      const faceUp = p.isHuman || (p.folded && p._peek) || (game.handOver && !p.folded && (game.stage === 'showdown' ? !!p.revealed : true));
      if (p.holeCards.length) {
        p.holeCards.forEach(c => {
          const cardEl = makeCard(c, { faceUp, win: winners.has(p.id) });
          if (faceUp && p._revealAnim) cardEl.classList.add('flip-in');
          cardsBox.appendChild(cardEl);
        });
      }
      if (p._revealAnim) p._revealAnim = false;

      // 弃牌玩家：底牌以牌背显示，可点击翻开查看（对手/自己均可）
      const peekHint = seat.querySelector('.peek-hint');
      if (p.folded && p.holeCards.length) {
        cardsBox.classList.add('peekable');
        cardsBox.title = p._peek ? '点击隐藏底牌' : '点击查看对手底牌';
        seat.classList.toggle('peeked', !!p._peek);
        if (peekHint) {
          peekHint.style.display = 'block';
          peekHint.textContent = p._peek ? '🂠 点击隐藏' : '👁 点击看牌';
        }
      } else {
        cardsBox.classList.remove('peekable');
        seat.classList.remove('peeked');
        if (peekHint) peekHint.style.display = 'none';
      }
    });

    // 本手结束 → 播放一次获胜音效
    if (game.handOver && !winPlayed) {
      winPlayed = true;
      setTimeout(() => { if (sfxOn) SFX.play('win'); }, 450);
    }

    // 本手结束 → 安排底池筹码飞向胜者（亮牌完成后）
    if (game.handOver && game.lastResults && !awardScheduled) {
      awardScheduled = true;
      const delay = game.stage === 'showdown'
        ? (game.showOrder ? game.showOrder.length * 650 + 340 : 340)
        : 340;
      setTimeout(awardPot, delay);
    }

    updateControls();
    updateMessage();
    maybeEstimateWinRate();
  }

  function updateMessage() {
    if (game.handOver) { el.message.textContent = game.lastMessage || '本手结束'; return; }
    const p = game.players[game.toAct];
    if (!p) { el.message.textContent = ''; return; }
    el.message.textContent = p.isHuman ? '轮到你了，请行动' : `${p.name} 行动中…`;
  }

  // 按底池比例计算加注到的总额（pot-sized raise 公式）
  function potSizedRaiseTo(frac, p, la) {
    const call = game.currentBet - p.bet;
    const P = game.pot + call;           // 含跟注额的池子
    let amt = Math.round((game.currentBet + frac * P) / BIG_BLIND) * BIG_BLIND;
    return Math.max(la.minRaiseTo, Math.min(amt, la.maxRaiseTo));
  }
  function presetLabel(frac) {
    const p = game.players[game.toAct];
    if (!p) return '';
    const la = game.legalActions();
    if (!la.raise) return '';
    const amt = potSizedRaiseTo(frac, p, la);
    const name = frac === 0.5 ? '½ 池' : frac === 0.66 ? '⅔ 池' : '满池';
    return `${name} ¥${amt}`;
  }
  function presetRaise(frac) {
    if (game.handOver) return;
    const p = game.players[game.toAct];
    if (!p || !p.isHuman) return;
    const la = game.legalActions();
    if (!la.raise) return;
    const amt = potSizedRaiseTo(frac, p, la);
    humanAct('raise', amt);
  }

  function updateControls() {
    const la = game.legalActions();
    const humanTurn = !game.handOver && game.toAct >= 0 && game.players[game.toAct] && game.players[game.toAct].isHuman;
    const disable = !humanTurn;

    el.btnFold.disabled = disable || !la.fold;
    el.btnCheck.style.display = la.check ? '' : 'none';
    el.btnCheck.disabled = disable;
    el.btnCall.style.display = la.call ? '' : 'none';
    el.btnCall.disabled = disable;
    el.btnCall.textContent = '跟注 ¥' + la.callAmount;

    // 加注组（½池 / ⅔池 / 满池 / 滑块 / All In）仅在可下注/加注时显示
    const canRaise = la.raise && humanTurn;
    el.grpRight.style.display = canRaise ? '' : 'none';
    if (canRaise) {
      el.btnR50.textContent = presetLabel(0.5);
      el.btnR66.textContent = presetLabel(0.66);
      el.btnR100.textContent = presetLabel(1.0);
      el.raiseRange.min = la.minRaiseTo;
      el.raiseRange.max = la.maxRaiseTo;
      el.raiseRange.step = BIG_BLIND;
      if (+el.raiseRange.value < la.minRaiseTo || +el.raiseRange.value > la.maxRaiseTo) {
        el.raiseRange.value = Math.min(la.maxRaiseTo, la.minRaiseTo + BIG_BLIND);
      }
    }
  }

  function stepRaise(delta) {
    if (el.grpRight.style.display === 'none') return;
    let v = (+el.raiseRange.value) + delta;
    v = Math.max(+el.raiseRange.min, Math.min(+el.raiseRange.max, v));
    el.raiseRange.value = v;
  }

  // ---- 胜率估算 (蒙特卡洛) ----
  function estimateWinRate(g, humanId, iters) {
    const human = g.players[humanId];
    if (!human.holeCards.length) return null;
    const used = new Set();
    human.holeCards.forEach(c => used.add(c.rank + '-' + c.suit));
    g.community.forEach(c => used.add(c.rank + '-' + c.suit));
    const deck = [];
    for (let r = 2; r <= 14; r++) for (const s of SUITS) if (!used.has(r + '-' + s)) deck.push({ rank: r, suit: s });
    const opponents = g.players.filter(p => p.id !== humanId && !p.folded && !p.busted);
    const need = 5 - g.community.length;
    let wins = 0, ties = 0;
    for (let it = 0; it < iters; it++) {
      const d = deck.slice();
      for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = d[i]; d[i] = d[j]; d[j] = t; }
      let idx = 0;
      const comm = g.community.slice();
      for (let k = 0; k < need; k++) comm.push(d[idx++]);
      const holes = [human.holeCards];
      for (const op of opponents) holes.push([d[idx++], d[idx++]]);
      const scores = holes.map(h => evaluate7(h.concat(comm)));
      let best = 0;
      for (let h = 1; h < scores.length; h++) if (compareScore(scores[h], scores[best]) > 0) best = h;
      let tie = 0;
      for (let h = 0; h < scores.length; h++) if (compareScore(scores[h], scores[best]) === 0) tie++;
      if (best === 0 && tie === 1) wins++;
      else if (best === 0 && tie > 1) ties++;
    }
    return Math.round(((wins + ties * 0.5) / iters) * 100);
  }

  let wrTimer = null;
  function maybeEstimateWinRate() {
    if (!winRateEnabled) return;
    const human = game.players.find(p => p.isHuman);
    if (!human || human.folded || game.handOver) return;
    if (wrTimer) clearTimeout(wrTimer);
    wrTimer = setTimeout(() => {
      const pct = estimateWinRate(game, human.id, WR_ITERS);
      human.winRate = pct;
      const idx = game.players.indexOf(human);
      const wrEl = seatEls[idx] && seatEls[idx].querySelector('.winrate');
      if (wrEl) wrEl.textContent = '🎯 胜率 ' + pct + '%';
    }, 40);
  }

  // ---- 回合驱动 ----
  function nextTurn() {
    render();
    if (game.handOver) {
      if (game.stage === 'showdown' && !revealing) { revealing = true; revealShowdown(); }
      el.btnNext.style.display = '';
      return;
    }
    // 无人可行动（全员 all-in / 仅剩 1 人未 all-in）：自动逐条街发牌，保持节奏
    if (game.toAct < 0) {
      if (!game.handOver && game.stage !== 'showdown' && !game.gameOver) {
        el.btnNext.style.display = 'none';
        setTimeout(dealNextStreet, 850);
      }
      return;
    }
    const p = game.players[game.toAct];
    if (!p) return;
    if (p.isHuman) return;
    el.btnNext.style.display = 'none';
    setTimeout(aiAct, AI_DELAY);
  }

  // 发下一条街（翻牌/转牌/河牌），再继续回合循环
  function dealNextStreet() {
    if (game.handOver || game.gameOver) return;
    game.proceed();
    nextTurn();
  }

  // 摊牌：按 showOrder（最后加注者先亮）逐张翻开
  function revealShowdown() {
    if (!game.handOver || game.stage !== 'showdown' || !game.showOrder || !game.showOrder.length) { render(); return; }
    let i = 0;
    const step = () => {
      if (i >= game.showOrder.length) { render(); return; }
      const pid = game.showOrder[i++];
      const p = game.players.find(x => x.id === pid);
      if (p && !p.revealed) { p.revealed = true; p._revealAnim = true; }
      render();
      setTimeout(step, 650);
    };
    step();
  }

  function aiAct() {
    if (game.handOver) { render(); return; }
    const p = game.players[game.toAct];
    if (!p || p.isHuman) return;
    const d = game.aiDecide(p);
    p.lastAction = actionText(d, p);
    p.lastActionType = d.action;
    p._actionAnim = true;
    log(`${p.name} ${p.lastAction}`);
    if (sfxOn) SFX.play(d.action);
    game.applyAction(d.action, d.amount);
    nextTurn();
  }

  function actionText(d, p) {
    if (d.action === 'fold') return '弃牌';
    if (d.action === 'check') return '过牌';
    if (d.action === 'call') return `跟注 ¥${Math.min(game.currentBet - p.bet, p.stack)}`;
    if (d.action === 'raise') return `加注到 ¥${d.amount}`;
    if (d.action === 'allin') return `All In ¥${p.stack + p.bet}`;
    return '';
  }

  // ---- 决策复盘点评（扑克教练）----
  // 通用准则：用蒙特卡洛估算玩家胜率，与「跟注所需的底池赔率」比较判断是否 +EV。
  // 参考：Pot Odds % = 跟注额 / (底池 + 跟注额)；胜率高于该值→跟注/加注有利，低于则弃牌更优。
  function gradeKey(g) {
    return g === '优秀' ? 'excellent' : g === '良好' ? 'good' : g === '一般' ? 'ok' : g === '偏差' ? 'poor' : 'bad';
  }
  function recommendLabel(a) {
    return { fold: '弃牌', check: '过牌', call: '跟注', raise: '加注', allin: 'All In' }[a] || a;
  }

  function evaluateHumanAction(g, action, amount) {
    const human = g.players[g.toAct];
    const equity = estimateWinRate(g, human.id, 500);          // 玩家胜率（%）
    const callAmount = Math.max(0, g.currentBet - human.bet);   // 面对下注时的跟注额
    const potAfterCall = g.pot + callAmount;
    const breakEven = potAfterCall > 0 ? (callAmount / potAfterCall) * 100 : 0; // 跟注盈亏平衡胜率
    const eq = Math.round(equity);
    const be = Math.round(breakEven);
    let grade, score, comment, recommended = action;

    if (action === 'fold') {
      if (callAmount === 0) {
        recommended = 'check'; grade = '偏差'; score = 45;
        comment = '当前无人下注，直接过牌即可，没必要弃牌。';
      } else if (eq < be - 5) {
        grade = '优秀'; score = 92;
        comment = `胜率 ${eq}% 低于跟注所需的 ${be}%，正确弃牌，省下 ¥${callAmount}（避免负EV）。`;
      } else if (eq < be + 5) {
        grade = '良好'; score = 78;
        comment = `胜率 ${eq}% 与跟注所需 ${be}% 接近，弃牌不算错，也可考虑跟注看牌。`;
      } else {
        recommended = 'call'; grade = '失误'; score = 28;
        comment = `胜率 ${eq}% 高于跟注所需的 ${be}%，这是一手正EV的牌，弃掉可惜了。`;
      }
    } else if (action === 'check') {
      if (callAmount > 0) {
        recommended = 'call'; grade = '偏差'; score = 50;
        comment = '面对下注时不能过牌，应跟注或弃牌。';
      } else if (eq >= 65) {
        recommended = 'raise'; grade = '一般'; score = 70;
        comment = `你约 ${eq}% 胜率（强牌），过牌虽稳，但错失了下注拿价值、做大底池的机会。`;
      } else {
        grade = '良好'; score = 85;
        comment = `胜率约 ${eq}%，过牌免费看牌、控制底池，是合理选择。`;
      }
    } else if (action === 'call') {
      if (callAmount === 0) {
        recommended = 'check'; grade = '一般'; score = 68;
        comment = '当前无人下注，跟注等同于过牌，直接过牌更简洁。';
      } else if (eq >= be + 15) {
        grade = '优秀'; score = 95;
        comment = `胜率 ${eq}% 远高于跟注所需的 ${be}%，是非常划算的跟注（+EV）。`;
      } else if (eq >= be + 3) {
        grade = '良好'; score = 82;
        comment = `胜率 ${eq}% 高于跟注所需的 ${be}%，跟注有利可图。`;
      } else if (eq >= be - 5) {
        grade = '一般'; score = 60;
        comment = `胜率 ${eq}% 与跟注所需 ${be}% 接近，属于边际跟注，长期基本持平。`;
      } else {
        recommended = 'fold'; grade = '偏差'; score = 38;
        comment = `胜率 ${eq}% 低于跟注所需的 ${be}%，跟注是负EV，长期会亏，建议弃牌。`;
      }
    } else { // raise / allin
      const label = action === 'allin' ? 'All In' : '加注';
      if (callAmount > 0 && eq < be - 8) {
        recommended = 'fold'; grade = '失误'; score = 25;
        comment = `你只有约 ${eq}% 胜率却选择${label}，风险极高；面对 ${be}% 的赔率，更稳的是弃牌。`;
      } else if (eq >= 60) {
        grade = eq >= 75 ? '优秀' : '良好'; score = eq >= 75 ? 93 : 84;
        comment = `约 ${eq}% 胜率（强牌），${label}建立/扩大底池、拿价值，打法正确。`;
      } else if (eq >= 40) {
        grade = '一般'; score = 65;
        comment = `约 ${eq}% 胜率，${label}偏激进；若作半诈唬/价值混合还行，注意别过度投入。`;
      } else {
        recommended = callAmount > 0 ? 'fold' : 'check'; grade = '偏差'; score = 40;
        comment = `约 ${eq}% 胜率偏低，用${label}投入较多筹码风险偏大，建议谨慎。`;
      }
    }

    const tip = recommended !== action ? recommendLabel(recommended) : null;
    return { grade, score, comment, equity: eq, breakEven: be, tip };
  }

  function logCoach(ev) {
    const div = document.createElement('div');
    div.className = 'coach g-' + gradeKey(ev.grade);
    div.innerHTML =
      `<span class="coach-badge">${ev.grade}</span>` +
      `<span class="coach-score">${ev.score}分</span>` +
      `<span class="coach-comment">${ev.comment}</span>` +
      (ev.tip ? `<span class="coach-tip">更优：${ev.tip}</span>` : '');
    el.log.appendChild(div);
    el.log.scrollTop = el.log.scrollHeight;
  }

  function humanAct(action, amount) {
    if (game.handOver) return;
    const p = game.players[game.toAct];
    if (!p || !p.isHuman) return;
    const d = { action, amount };
    p.lastAction = actionText(d, p);
    p.lastActionType = d.action;
    p._actionAnim = true;
    log(`你 ${p.lastAction}`, true);
    // 决策复盘点评：在你每次操作之后给出评价与打分
    const ev = evaluateHumanAction(game, action, amount);
    logCoach(ev);
    if (sfxOn) SFX.play(action);
    game.applyAction(action, amount);
    el.btnNext.style.display = 'none';
    nextTurn();
  }

  // ---- 新一手 / 结束 ----
  function newHand() {
    el.btnNext.style.display = 'none';
    el.log.innerHTML = '';
    game.players.forEach(p => { p.lastAction = ''; p.lastActionType = ''; p.winRate = null; p.revealed = false; p._revealAnim = false; p._actionAnim = false; p._shownBet = 0; p._peek = false; });
    prevCommLen = 0;
    revealing = false;
    winPlayed = false;
    awardScheduled = false;
    awardedAnim = false;
    game.startHand();
    if (game.gameOver) { renderGameOver(); return; }
    render();
    nextTurn();
  }

  // 筹码从某座位飞向底池的动画
  function flyChips(seatIndex, amount) {
    const seatEl = seatEls[seatIndex];
    if (!seatEl) return;
    const from = seatEl.getBoundingClientRect();
    const to = el.pot.getBoundingClientRect();
    const chip = document.createElement('div');
    chip.className = 'chip-fly';
    chip.textContent = '¥' + amount;
    document.body.appendChild(chip);
    const x0 = from.left + from.width / 2, y0 = from.top + from.height / 2;
    const x1 = to.left + to.width / 2, y1 = to.top + to.height / 2;
    chip.style.left = x0 + 'px';
    chip.style.top = y0 + 'px';
    const anim = chip.animate([
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
      { transform: `translate(-50%,-50%) translate(${(x1 - x0) * 0.5}px, ${(y1 - y0) * 0.5 - 46}px) scale(1.15)`, opacity: 1, offset: 0.55 },
      { transform: `translate(-50%,-50%) translate(${x1 - x0}px, ${y1 - y0}px) scale(.45)`, opacity: 0.15 }
    ], { duration: 540, easing: 'cubic-bezier(.4,.1,.6,1)' });
    anim.onfinish = () => {
      chip.remove();
      el.pot.classList.add('bump');
      setTimeout(() => el.pot.classList.remove('bump'), 320);
    };
  }

  // 筹码从底池中央飞向某座位（派彩给赢家）
  function flyChipsTo(seatIndex, amount) {
    const seatEl = seatEls[seatIndex];
    if (!seatEl || seatEl.style.display === 'none') return;
    const from = el.pot.getBoundingClientRect();
    const toEl = seatEl.querySelector('.chips') || seatEl;
    const to = toEl.getBoundingClientRect();
    const chip = document.createElement('div');
    chip.className = 'chip-fly to';
    chip.textContent = '¥' + amount;
    document.body.appendChild(chip);
    const x0 = from.left + from.width / 2, y0 = from.top + from.height / 2;
    const x1 = to.left + to.width / 2, y1 = to.top + to.height / 2;
    const dx = x1 - x0, dy = y1 - y0;
    chip.style.left = x0 + 'px';
    chip.style.top = y0 + 'px';
    const anim = chip.animate([
      { transform: 'translate(-50%,-50%) scale(1.05)', opacity: 1 },
      { transform: `translate(-50%,-50%) translate(${dx * 0.5}px, ${dy * 0.5 - 46}px) scale(1.18)`, opacity: 1, offset: 0.5 },
      { transform: `translate(-50%,-50%) translate(${dx}px, ${dy}px) scale(.5)`, opacity: .25 }
    ], { duration: 640, easing: 'cubic-bezier(.3,.7,.35,1)' });
    anim.onfinish = () => {
      chip.remove();
      seatEl.classList.add('collecting');
      setTimeout(() => seatEl.classList.remove('collecting'), 540);
    };
  }

  // 本小局结束：底池金额按 lastResults 飞向各胜者（多赢家=多条路线）
  function awardPot() {
    if (awardedAnim) return;
    awardedAnim = true;
    const results = game.lastResults;
    if (results && results.length) {
      if (sfxOn) SFX.play('collect');
      // 把每个池子的赢家金额累加，得到每位赢家的总入账
      const winMap = {};
      results.forEach(r => {
        (r.winners || []).forEach(w => {
          const wid = (typeof w === 'number') ? w : (w.id != null ? w.id : null);
          if (wid == null) return;
          const amt = (typeof w === 'number') ? r.pot : (w.amount || 0);
          winMap[wid] = (winMap[wid] || 0) + amt;
        });
      });
      Object.keys(winMap).forEach(wid => {
        const idx = game.players.findIndex(p => p.id === +wid);
        if (idx >= 0) flyChipsTo(idx, winMap[wid]);
      });
      el.pot.innerHTML = '底池 <b>¥0</b>';
    }
  }

  // 顶部提示
  function toast(text) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 350); }, 1900);
  }

  // 礼花（canvas 实时绘制，约 5 秒后自动停止）
  let confettiRAF = null;
  function launchConfetti(durationMs = 5000) {
    const canvas = document.getElementById('confetti');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.classList.add('show');
    const colors = ['#e0a93b', '#d9483b', '#3b7dd9', '#2c9b66', '#f4c256', '#ffffff', '#9b59b6'];
    const N = Math.min(180, Math.floor(window.innerWidth / 8));
    const parts = [];
    for (let i = 0; i < N; i++) {
      parts.push({
        x: Math.random() * canvas.width,
        y: -20 - Math.random() * canvas.height * 0.6,
        w: 6 + Math.random() * 8,
        h: 8 + Math.random() * 12,
        vy: 2.2 + Math.random() * 4.5,
        vx: -2 + Math.random() * 4,
        rot: Math.random() * Math.PI,
        vr: -0.25 + Math.random() * 0.5,
        color: colors[(Math.random() * colors.length) | 0],
        sway: Math.random() * Math.PI * 2,
      });
    }
    const start = performance.now();
    if (confettiRAF) cancelAnimationFrame(confettiRAF);
    function frame(now) {
      const t = now - start;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of parts) {
        p.sway += 0.05;
        p.x += p.vx + Math.sin(p.sway) * 0.7;
        p.y += p.vy;
        p.rot += p.vr;
        if (p.y > canvas.height + 24) { p.y = -20; p.x = Math.random() * canvas.width; }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (t < durationMs) confettiRAF = requestAnimationFrame(frame);
      else { ctx.clearRect(0, 0, canvas.width, canvas.height); canvas.classList.remove('show'); confettiRAF = null; }
    }
    confettiRAF = requestAnimationFrame(frame);
  }

  function showVictory(winner) {
    const v = document.getElementById('victory');
    document.getElementById('victoryName').textContent = winner.name;
    document.getElementById('victoryStack').textContent = '最终筹码 ¥' + winner.stack;
    const vc = document.getElementById('victoryCards');
    vc.innerHTML = '';
    (winner.holeCards || []).forEach(c => vc.appendChild(makeCard(c)));
    v.classList.remove('hide');
    launchConfetti(5200);
    if (sfxOn) SFX.play('win');
  }
  function hideVictory() {
    const v = document.getElementById('victory');
    if (v) v.classList.add('hide');
    const cv = document.getElementById('confetti');
    if (cv && confettiRAF) { cancelAnimationFrame(confettiRAF); confettiRAF = null; cv.classList.remove('show'); }
  }

  function renderGameOver() {
    el.message.textContent = '游戏结束';
    el.btnNext.style.display = 'none';
    el.controls.style.display = 'none';
    const winner = [...game.players].sort((a, b) => b.stack - a.stack)[0];
    log(`🏆 最终赢家：${winner.name}（¥${winner.stack}）`);
    showVictory(winner);
    render();
  }

  // ---- 事件 ----
  el.btnFold.addEventListener('click', () => humanAct('fold'));
  el.btnCheck.addEventListener('click', () => humanAct('check'));
  el.btnCall.addEventListener('click', () => humanAct('call'));
  el.btnR50.addEventListener('click', () => presetRaise(0.5));
  el.btnR66.addEventListener('click', () => presetRaise(0.66));
  el.btnR100.addEventListener('click', () => presetRaise(1.0));
  el.btnAllIn.addEventListener('click', () => humanAct('allin'));
  el.btnRaiseMinus.addEventListener('click', () => { if (sfxOn) SFX.play('button'); stepRaise(-BIG_BLIND); });
  el.btnRaisePlus.addEventListener('click', () => { if (sfxOn) SFX.play('button'); stepRaise(BIG_BLIND); });
  el.btnNext.addEventListener('click', () => { if (sfxOn) SFX.play('button'); newHand(); });
  el.btnWinRate.addEventListener('click', () => {
    winRateEnabled = !winRateEnabled;
    el.btnWinRate.textContent = '胜率：' + (winRateEnabled ? '显示' : '隐藏');
    if (!winRateEnabled && game) {
      const human = game.players.find(p => p.isHuman);
      if (human) human.winRate = null;
    }
    if (game) render();
  });

  // 点击已弃牌玩家的底牌（牌背）翻看 / 隐藏
  el.seats.addEventListener('click', (e) => {
    const target = e.target.closest('.cards.peekable, .peek-hint');
    if (!target) return;
    const seatEl = target.closest('.seat');
    const idx = seatEls.indexOf(seatEl);
    if (idx < 0) return;
    const p = game.players[idx];
    if (!p || !p.folded || !p.holeCards.length) return;
    p._peek = !p._peek;
    if (sfxOn) SFX.play('button');
    render();
  });

  // 冠军界面：中下部"再来一局"
  const btnNewGameCenter = document.getElementById('btnNewGameCenter');
  if (btnNewGameCenter) btnNewGameCenter.addEventListener('click', () => {
    if (sfxOn) SFX.play('button');
    startGame();
  });

  // ---- 启动：先显示开始界面 ----
  showStartScreen();
})();
