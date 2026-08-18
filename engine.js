/* ============================================================
 *  德州扑克核心引擎 (Texas Hold'em Engine)
 *  - 牌组 / 洗牌
 *  - 7 选 5 最佳牌型判定
 *  - 下注状态机 (盲注 / 跟注 / 加注 / 全下 / 过牌 / 弃牌)
 *  - 边池 (side pot) 计算
 *  - AI 决策
 *  纯逻辑，无 DOM 依赖。可在浏览器或 Node 中使用。
 * ============================================================ */

// --- 基础常量 ---
const SUITS = ['s', 'h', 'd', 'c']; // 黑桃 红桃 方块 梅花
const SUIT_SYMBOL = { s: '♠', h: '♥', d: '♦', c: '♣' };
const SUIT_COLOR = { s: 'black', h: 'red', d: 'red', c: 'black' };
const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

function rankLabel(r) {
  return RANK_LABEL[r] || String(r);
}

function handLabel(score) {
  if (!score) return '';
  const [a, b, c] = score.tiebreak;
  switch (score.category) {
    case 10: return score.name;
    case 9: return `${score.name} ${rankLabel(a)}高`;
    case 8: return `${score.name} ${rankLabel(a)}`;
    case 7: return `${score.name} ${rankLabel(a)}带${rankLabel(b)}`;
    case 6: return `${score.name} ${rankLabel(a)}大`;
    case 5: return `${score.name} ${rankLabel(a)}高`;
    case 4: return `${score.name} ${rankLabel(a)}`;
    case 3: return `${score.name} ${rankLabel(a)}和${rankLabel(b)}`;
    case 2: return `${score.name} ${rankLabel(a)}`;
    default: return `${score.name} ${rankLabel(a)}大`;
  }
}

const CATEGORY_NAMES = [
  '高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺', '皇家同花顺'
];

// --- 牌组 ---
function makeDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (let r = 2; r <= 14; r++) {
      deck.push({ rank: r, suit: s });
    }
  }
  return deck;
}

function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// --- 牌型判定 ---
// 给定 5 张牌，返回 { category:1..10, tiebreak:[...], name }
function evaluate5(cards) {
  const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);
  const isFlush = suits.every(s => s === suits[0]);

  const cnt = {};
  ranks.forEach(r => { cnt[r] = (cnt[r] || 0) + 1; });
  const groups = Object.keys(cnt)
    .map(r => ({ r: +r, c: cnt[r] }))
    .sort((a, b) => b.c - a.c || b.r - a.r);
  const counts = groups.map(g => g.c);

  // 顺子检测 (含 A-2-3-4-5 轮子)
  const uniq = [...new Set(ranks)].sort((a, b) => b - a);
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[2] === 4 && uniq[3] === 3 && uniq[4] === 2) straightHigh = 5;
  }

  // 皇家/同花顺
  if (isFlush && straightHigh) {
    const cat = straightHigh === 14 ? 10 : 9;
    return { category: cat, tiebreak: [straightHigh], name: CATEGORY_NAMES[cat - 1] };
  }
  // 四条
  if (counts[0] === 4) {
    return { category: 8, tiebreak: [groups[0].r, groups[1].r], name: CATEGORY_NAMES[7] };
  }
  // 葫芦
  if (counts[0] === 3 && counts[1] === 2) {
    return { category: 7, tiebreak: [groups[0].r, groups[1].r], name: CATEGORY_NAMES[6] };
  }
  // 同花
  if (isFlush) {
    return { category: 6, tiebreak: ranks.slice(), name: CATEGORY_NAMES[5] };
  }
  // 顺子
  if (straightHigh) {
    return { category: 5, tiebreak: [straightHigh], name: CATEGORY_NAMES[4] };
  }
  // 三条
  if (counts[0] === 3) {
    const kickers = groups.slice(1).map(g => g.r).sort((a, b) => b - a);
    return { category: 4, tiebreak: [groups[0].r, ...kickers], name: CATEGORY_NAMES[3] };
  }
  // 两对
  if (counts[0] === 2 && counts[1] === 2) {
    const pairs = groups.slice(0, 2).map(g => g.r).sort((a, b) => b - a);
    return { category: 3, tiebreak: [...pairs, groups[2].r], name: CATEGORY_NAMES[2] };
  }
  // 一对
  if (counts[0] === 2) {
    const kickers = groups.slice(1).map(g => g.r).sort((a, b) => b - a);
    return { category: 2, tiebreak: [groups[0].r, ...kickers], name: CATEGORY_NAMES[1] };
  }
  // 高牌
  return { category: 1, tiebreak: ranks.slice(), name: CATEGORY_NAMES[0] };
}

// 比较两手牌: >0 表示 a 更大
function compareScore(a, b) {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < len; i++) {
    const x = a.tiebreak[i] || 0;
    const y = b.tiebreak[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

// 从 7 张里挑出最优 5 张
function evaluate7(cards) {
  const n = cards.length;
  let best = null, bestCards = null;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++)
        for (let l = k + 1; l < n; l++)
          for (let m = l + 1; m < n; m++) {
            const five = [cards[i], cards[j], cards[k], cards[l], cards[m]];
            const e = evaluate5(five);
            if (!best || compareScore(e, best) > 0) { best = e; bestCards = five; }
          }
  if (best) best.cards = bestCards;
  return best;
}

// --- 游戏 ---
class PokerGame {
  constructor(opts = {}) {
    this.numPlayers = opts.numPlayers || 4;       // 含 1 名玩家
    this.startingStack = opts.startingStack || 1000;
    this.bigBlind = opts.bigBlind || 20;
    this.smallBlind = Math.max(1, Math.floor(this.bigBlind / 2));
    this.aggression = (opts.aggression != null) ? opts.aggression : 0.5; // 0=保守 1=激进
    const aiNames = opts.aiNames || ['阿强', '小红', '老李', '大壮', '小美', '阿明'];
    this.players = [];
    this.players.push({ id: 0, name: '你', isHuman: true, stack: this.startingStack, holeCards: [], bet: 0, totalBet: 0, folded: false, allIn: false, hasActed: false, busted: false, isDealer: false });
    for (let i = 1; i < this.numPlayers; i++) {
      this.players.push({ id: i, name: aiNames[(i - 1) % aiNames.length], isHuman: false, stack: this.startingStack, holeCards: [], bet: 0, totalBet: 0, folded: false, allIn: false, hasActed: false, busted: false, isDealer: false });
    }
    this.deck = [];
    this.community = [];
    this.pot = 0;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.stage = 'preflop';
    this.dealerIndex = -1;
    this.toAct = -1;
    this.handOver = false;
    this.gameOver = false;
    this.lastResults = null;   // 结算明细
    this.lastMessage = '';
    this.handNumber = 0;
    this.burns = [];           // 烧牌堆（每发一轮公共牌前烧 1 张）
    this.riverAggressor = null;// 河牌圈最后加注者（决定摊牌亮牌顺序）
    this.showOrder = [];       // 摊牌亮牌顺序（玩家 id）
  }

  // ---- 辅助 ----
  nextNonBusted(i) {
    const n = this.players.length;
    for (let k = 0; k < n; k++) {
      const idx = (i + k) % n;
      if (!this.players[idx].busted) return idx;
    }
    return -1;
  }
  nextActiveIndex(i) {
    const n = this.players.length;
    for (let k = 0; k < n; k++) {
      const idx = (i + k) % n;
      const p = this.players[idx];
      if (!p.busted && !p.folded && !p.allIn) return idx;
    }
    return -1;
  }
  activePlayers() {
    return this.players.filter(p => !p.busted && !p.folded && !p.allIn);
  }
  notFoldedPlayers() {
    return this.players.filter(p => !p.busted && !p.folded);
  }

  // ---- 开局 ----
  startHand() {
    this.handNumber++;
    const withChips = this.players.filter(p => p.stack > 0);
    if (withChips.length < 2) { this.gameOver = true; return; }

    this.players.forEach(p => {
      p.holeCards = []; p.bet = 0; p.totalBet = 0;
      p.folded = false; p.allIn = false; p.hasActed = false; p.isDealer = false;
      p.revealed = false;
      if (p.stack <= 0) p.busted = true;
    });
    this.burns = [];
    this.riverAggressor = null;
    this.showOrder = [];

    this.dealerIndex = this.nextNonBusted(this.dealerIndex + 1);
    this.players[this.dealerIndex].isDealer = true;

    this.deck = shuffle(makeDeck());
    this.community = [];
    this.pot = 0;
    this.handOver = false;
    this.lastResults = null;
    this.stage = 'preflop';

    // 发底牌
    for (let r = 0; r < 2; r++) {
      for (const p of this.players) if (!p.busted) p.holeCards.push(this.deck.pop());
    }

    // 盲注：单挑时庄家=小盲；多人时庄家左侧=小盲
    const nP = this.players.length;
    let sbIdx, bbIdx;
    if (nP === 2) {
      sbIdx = this.dealerIndex;
      bbIdx = this.nextNonBusted(this.dealerIndex + 1);
    } else {
      sbIdx = this.nextNonBusted(this.dealerIndex + 1);
      bbIdx = this.nextNonBusted(sbIdx + 1);
    }
    this._postBlind(this.players[sbIdx], this.smallBlind);
    this._postBlind(this.players[bbIdx], this.bigBlind);
    this.currentBet = this.bigBlind;
    this.minRaise = this.bigBlind;

    this.toAct = this.firstToAct();
    if (this.toAct === -1) this.proceed();
  }

  _postBlind(p, amt) {
    const pay = Math.min(amt, p.stack);
    p.stack -= pay; p.bet += pay; p.totalBet += pay; this.pot += pay;
    if (p.stack === 0) p.allIn = true;
  }

  firstToAct() {
    const n = this.players.length;
    let start;
    if (n === 2) {
      // 单挑：庄家(小盲)翻牌前、翻牌后都先行动
      start = this.dealerIndex;
    } else {
      start = this.stage === 'preflop' ? (this.dealerIndex + 3) % n : (this.dealerIndex + 1) % n;
    }
    return this.nextActiveIndex(start);
  }

  // ---- 下注动作 ----
  legalActions() {
    const p = this.players[this.toAct];
    if (!p) return { fold: false, check: false, call: false, raise: false, allIn: false, callAmount: 0 };
    const callAmount = this.currentBet - p.bet;
    const maxRaiseTo = p.bet + p.stack;
    const minRaiseTo = this.currentBet + this.minRaise;
    return {
      fold: true,
      check: callAmount === 0,
      call: callAmount > 0,
      callAmount: Math.min(callAmount, p.stack),
      raise: p.stack > callAmount && minRaiseTo <= maxRaiseTo,
      minRaiseTo,
      maxRaiseTo,
      allIn: p.stack > 0
    };
  }

  fold() {
    const p = this.players[this.toAct];
    p.folded = true; p.hasActed = true;
  }
  check() {
    const p = this.players[this.toAct];
    if (this.currentBet - p.bet !== 0) throw new Error('不能过牌，需跟注');
    p.hasActed = true;
  }
  call() {
    const p = this.players[this.toAct];
    const need = Math.min(this.currentBet - p.bet, p.stack);
    p.stack -= need; p.bet += need; p.totalBet += need; this.pot += need;
    if (p.stack === 0) p.allIn = true;
    p.hasActed = true;
  }
  raiseTo(total) {
    const p = this.players[this.toAct];
    const need = Math.min(total - p.bet, p.stack);
    const raiseSize = (p.bet + need) - this.currentBet;
    if (raiseSize > this.minRaise) this.minRaise = raiseSize;
    p.stack -= need; p.bet += need; p.totalBet += need; this.pot += need;
    if (p.stack === 0) p.allIn = true;
    this.currentBet = p.bet;
    if (this.stage === 'river') this.riverAggressor = p.id; // 记录河牌圈最后加注者
    // 其他人需要重新行动
    this.players.forEach(o => {
      if (o !== p && !o.busted && !o.folded && !o.allIn) o.hasActed = false;
    });
    p.hasActed = true;
  }
  allIn() {
    const p = this.players[this.toAct];
    const total = p.bet + p.stack;
    this.raiseTo(total);
  }

  // 统一入口
  applyAction(action, amount = 0) {
    switch (action) {
      case 'fold': this.fold(); break;
      case 'check': this.check(); break;
      case 'call': this.call(); break;
      case 'raise': this.raiseTo(amount); break;
      case 'allin': this.allIn(); break;
      default: throw new Error('未知动作: ' + action);
    }
    this.afterAction();
  }

  afterAction() {
    const notFolded = this.notFoldedPlayers();
    if (notFolded.length === 1) {
      this._awardSingle(notFolded[0]);
      this.handOver = true;
      return;
    }
    if (this.isRoundComplete()) { this.proceed(); return; }
    this.toAct = this.nextActiveIndex(this.toAct + 1);
    if (this.toAct === -1) this.proceed();
  }

  isRoundComplete() {
    const active = this.activePlayers();
    if (active.length <= 1) return true;
    if (this.notFoldedPlayers().length <= 1) return true;
    return active.every(p => p.hasActed && p.bet === this.currentBet);
  }

  proceed() {
    if (this.stage === 'preflop') { this._dealCommunity(3); this.stage = 'flop'; }
    else if (this.stage === 'flop') { this._dealCommunity(1); this.stage = 'turn'; }
    else if (this.stage === 'turn') { this._dealCommunity(1); this.stage = 'river'; }
    else { this.showdown(); return; }

    this.players.forEach(p => { if (!p.busted) { p.bet = 0; p.hasActed = false; } });
    this.currentBet = 0;
    this.minRaise = this.bigBlind;

    // 每次只发一条街；若全场已 all-in（toAct 为 -1），由 UI 用定时器逐街推进，保持节奏
    this.toAct = this.firstToAct();
  }

  _dealCommunity(k) {
    this.burns.push(this.deck.pop()); // 烧牌：发公共牌前烧掉顶牌（暗牌）
    for (let i = 0; i < k; i++) this.community.push(this.deck.pop());
  }

  _awardSingle(winner) {
    winner.stack += this.pot;
    this.lastMessage = `${winner.name} 赢得底池 ¥${this.pot}（其余玩家弃牌）`;
    this.lastResults = [{ pot: this.pot, winners: [winner.id], reason: '其他人弃牌' }];
    this.pot = 0;
  }

  // ---- 边池 ----
  computePots() {
    const contribs = this.players
      .filter(p => p.totalBet > 0)
      .map(p => ({ id: p.id, total: p.totalBet, folded: p.folded }));
    const pots = [];
    while (contribs.length > 0) {
      const min = Math.min(...contribs.map(c => c.total));
      let amount = 0;
      const eligible = [];
      contribs.forEach(c => {
        amount += min;
        c.total -= min;
        if (!c.folded) eligible.push(c.id);
      });
      pots.push({ amount, eligible });
      // 移除已耗尽筹码的玩家
      for (let i = contribs.length - 1; i >= 0; i--) if (contribs[i].total === 0) contribs.splice(i, 1);
    }
    return pots;
  }

  showdown() {
    this.stage = 'showdown';
    const notFolded = this.notFoldedPlayers();
    const pots = this.computePots();
    this.showOrder = this._computeShowOrder(notFolded);

    // 给每位未弃牌玩家算出最大牌型，避免每个边池重复计算
    notFolded.forEach(p => {
      p.bestHand = evaluate7([...p.holeCards, ...this.community]);
    });

    const results = [];
    for (const pot of pots) {
      if (pot.amount <= 0) continue;
      let contenders = notFolded.filter(p => pot.eligible.includes(p.id));
      let winners;
      if (contenders.length === 0) {
        // 边池无人可领 (理论极端情况) -> 给到未弃牌者
        winners = notFolded;
      } else {
        let best = null;
        for (const p of contenders) {
          const sc = p.bestHand;
          if (!best || compareScore(sc, best.sc) > 0) best = { p, sc };
        }
        winners = contenders.filter(p => compareScore(p.bestHand, best.sc) === 0);
      }
      const share = Math.floor(pot.amount / winners.length);
      let rem = pot.amount - share * winners.length;
      const dist = winners.map((w, i) => {
        const amt = share + (i < rem ? 1 : 0);
        w.stack += amt;
        return { id: w.id, amount: amt, hand: handLabel(w.bestHand) };
      });
      results.push({ pot: pot.amount, winners: dist, hand: handLabel(winners[0].bestHand) });
    }
    this.pot = 0;
    this.handOver = true;

    // 按池子生成清晰文案：主池 / 边池 + 牌型
    const lines = results.map((r, idx) => {
      const names = r.winners.map(w => this.players[w.id].name).join('、');
      const potName = results.length === 1 ? '底池' : (idx === 0 ? '主池' : '边池');
      return `${names} 赢得${potName} ¥${r.pot}（${r.hand}）`;
    });
    this.lastMessage = lines.join('；');
    this.lastResults = results;
  }

  _computeShowOrder(notFolded) {
    if (notFolded.length === 0) return [];
    let startIdx = -1;
    if (this.riverAggressor != null) {
      const ra = this.players.find(p => p.id === this.riverAggressor);
      if (ra && !ra.folded && !ra.busted) startIdx = this.players.indexOf(ra);
    }
    if (startIdx === -1) {
      for (let k = 1; k <= this.players.length; k++) {
        const i = (this.dealerIndex + k) % this.players.length;
        const p = this.players[i];
        if (!p.busted && !p.folded) { startIdx = i; break; }
      }
    }
    if (startIdx === -1) startIdx = this.players.indexOf(notFolded[0]);
    const order = [];
    for (let k = 0; k < this.players.length; k++) {
      const p = this.players[(startIdx + k) % this.players.length];
      if (!p.folded && !p.busted) order.push(p.id);
    }
    return order;
  }

  // ---- AI ----
  estimateStrength(p) {
    if (this.stage === 'preflop') return this._preflopStrength(p.holeCards);
    return this._postflopStrength(p.holeCards, this.community);
  }

  _preflopStrength(hole) {
    const [a, b] = hole.map(c => c.rank).sort((x, y) => y - x);
    const suited = hole[0].suit === hole[1].suit;
    if (a === b) {
      return Math.min(0.5 + (a - 2) / 12 * 0.45, 0.95); // 22 ~0.5, AA ~0.95
    }
    let s = (a / 14) * 0.5 + (b / 14) * 0.3;
    if (suited) s += 0.08;
    const gap = a - b;
    if (gap === 1) s += 0.05;
    if (gap <= 2 && suited) s += 0.03;
    if (a >= 13) s += 0.05;
    return Math.min(Math.max(s, 0.05), 0.9);
  }

  _postflopStrength(hole, community) {
    const best = evaluate7([...hole, ...community]);
    const base = { 1: 0.15, 2: 0.35, 3: 0.55, 4: 0.7, 5: 0.8, 6: 0.85, 7: 0.92, 8: 0.96, 9: 0.99, 10: 1.0 }[best.category] || 0.1;
    const opp = this.notFoldedPlayers().length - 1;
    const adj = base - Math.max(0, opp - 1) * 0.03;
    return Math.max(0.05, Math.min(adj, 1));
  }

  _betSizing(strength, a) {
    const frac = 0.35 + strength * 0.4 + a * 0.2; // 越激进下注越大
    let amt = Math.round((this.pot * frac) / this.bigBlind) * this.bigBlind;
    amt = Math.max(this.currentBet + this.minRaise, amt);
    return amt;
  }
  _raiseSizing(p, strength, a) {
    const inc = Math.round((this.currentBet * (0.5 + strength * 0.8 + a * 0.3) + this.minRaise) / this.bigBlind) * this.bigBlind;
    let amt = Math.min(this.currentBet + inc, p.bet + p.stack);
    amt = Math.max(this.currentBet + this.minRaise, amt);
    return amt;
  }

  // a = this.aggression (0..1)
  aiDecide(p) {
    const a = this.aggression;
    const strength = this.estimateStrength(p);
    const callAmount = this.currentBet - p.bet;
    const potOdds = callAmount > 0 ? callAmount / (this.pot + callAmount) : 0;
    const r = Math.random();

    if (callAmount === 0) {
      // 可过牌或下注
      if (strength > 0.72 - a * 0.4 || (strength > 0.5 - a * 0.25 && r < 0.25 + a * 0.4)) {
        const amt = Math.min(this._betSizing(strength, a), p.bet + p.stack);
        return { action: 'raise', amount: amt };
      }
      return { action: 'check' };
    }
    // 面对下注
    if (strength > 0.78 - a * 0.38 && r < 0.55 + a * 0.35) {
      const amt = Math.min(this._raiseSizing(p, strength, a), p.bet + p.stack);
      return { action: 'raise', amount: amt };
    }
    if (strength > potOdds + 0.12 - a * 0.1) return { action: 'call' };
    if (strength > potOdds - 0.05 && r < 0.15 + a * 0.2) return { action: 'call' };
    if (strength < 0.35 - a * 0.2 && r < 0.07 - a * 0.03) {
      // 偶尔诈唬加注 (激进时更少)
      const amt = Math.min(this._raiseSizing(p, strength, a), p.bet + p.stack);
      return { action: 'raise', amount: amt };
    }
    return { action: 'fold' };
  }
}

// --- Node 自测 ---
if (typeof module !== 'undefined' && require.main === module) {
  function card(r, s) { return { rank: r, suit: s }; }
  function assert(cond, msg) { if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; } else console.log('✅', msg); }

  // 皇家同花顺 > 四条
  const rf = evaluate7([card(14, 's'), card(13, 's'), card(12, 's'), card(11, 's'), card(10, 's'), card(2, 'h'), card(3, 'd')]);
  const quads = evaluate7([card(9, 's'), card(9, 'h'), card(9, 'd'), card(9, 'c'), card(5, 's'), card(2, 'h'), card(3, 'd')]);
  assert(rf.category === 10, '皇家同花顺 = 10');
  assert(quads.category === 8, '四条 = 8');
  assert(compareScore(rf, quads) > 0, '皇家同花顺 大于 四条');

  // 轮子顺子 A-2-3-4-5 (high=5) 小于 6-7-8-9-10 顺子
  const wheel = evaluate7([card(14, 's'), card(2, 'h'), card(3, 'd'), card(4, 'c'), card(5, 's'), card(9, 'h'), card(13, 'd')]);
  const sixStraight = evaluate7([card(6, 's'), card(7, 'h'), card(8, 'd'), card(9, 'c'), card(10, 's'), card(2, 'h'), card(3, 'd')]);
  assert(wheel.category === 5 && wheel.tiebreak[0] === 5, '轮子顺子 high=5');
  assert(sixStraight.tiebreak[0] === 10, '顺子 6-10 high=10');
  assert(compareScore(sixStraight, wheel) > 0, '10-high 顺子 大于 5-high 顺子');

  // 葫芦 > 同花
  const full = evaluate7([card(7, 's'), card(7, 'h'), card(7, 'd'), card(4, 'c'), card(4, 's'), card(2, 'h'), card(3, 'd')]);
  const flush = evaluate7([card(2, 's'), card(5, 's'), card(8, 's'), card(11, 's'), card(13, 's'), card(3, 'h'), card(9, 'd')]);
  assert(full.category === 7, '葫芦 = 7');
  assert(flush.category === 6, '同花 = 6');
  assert(compareScore(full, flush) > 0, '葫芦 大于 同花');

  // 两对 vs 一对
  const twoPair = evaluate7([card(10, 's'), card(10, 'h'), card(6, 'd'), card(6, 'c'), card(2, 's'), card(3, 'h'), card(14, 'd')]);
  const onePair = evaluate7([card(10, 's'), card(10, 'h'), card(5, 'd'), card(6, 'c'), card(2, 's'), card(3, 'h'), card(14, 'd')]);
  assert(twoPair.category === 3, '两对 = 3');
  assert(onePair.category === 2, '一对 = 2');
  assert(compareScore(twoPair, onePair) > 0, '两对 大于 一对');

  // 边池: 短码全下, 长码之间分主池
  const g = new PokerGame({ numPlayers: 3, startingStack: 1000, bigBlind: 20 });
  g.players[0].totalBet = 20; g.players[0].stack = 0; g.players[0].allIn = true; g.players[0].folded = false;
  g.players[1].totalBet = 100; g.players[1].folded = false;
  g.players[2].totalBet = 100; g.players[2].folded = false;
  const pots = g.computePots();
  assert(pots.length === 2, '产生 2 个边池');
  assert(pots[0].amount === 60 && pots[0].eligible.length === 3, '主池 60, 三人可领');
  assert(pots[1].amount === 160 && pots[1].eligible.length === 2, '边池 160, 两人可领');

  console.log('\n自测完成。');
}

// --- 浏览器导出 ---
if (typeof module !== 'undefined') {
  module.exports = { PokerGame, evaluate7, evaluate5, compareScore, makeDeck, shuffle, rankLabel, SUIT_SYMBOL, SUIT_COLOR, handLabel };
}
