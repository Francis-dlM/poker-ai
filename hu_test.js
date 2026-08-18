const { PokerGame } = require('./engine.js');

function autoPlayToEnd(g, maxTurns = 2000) {
  let t = 0;
  while (!g.handOver && t++ < maxTurns) {
    const p = g.players[g.toAct];
    if (!p) break;
    if (p.isHuman) {
      const la = g.legalActions();
      g.applyAction(la.call ? 'call' : 'check');
      continue;
    }
    const d = g.aiDecide(p);
    g.applyAction(d.action, d.amount);
  }
}

// ---- 单挑盲注与行动顺序 ----
const g = new PokerGame({ numPlayers: 2, startingStack: 1000, bigBlind: 20 });
g.startHand();
const dealer = g.players[g.dealerIndex];
const other = g.players.find(p => p.id !== g.dealerIndex);
console.log('[单挑] dealerIndex =', g.dealerIndex);
console.log('[单挑] 庄家(按钮)下注 =', dealer.bet, ' 期望小盲 =', g.smallBlind, dealer.bet === g.smallBlind ? '✅' : '❌');
console.log('[单挑] 另一家下注 =', other.bet, ' 期望大盲 =', g.bigBlind, other.bet === g.bigBlind ? '✅' : '❌');
console.log('[单挑] 翻牌前 firstToAct =', g.toAct, ' 期望 =', g.dealerIndex, g.toAct === g.dealerIndex ? '✅' : '❌');

g.applyAction('call');   // 庄家(小盲)跟注到 20
g.applyAction('check');  // 大盲过牌
console.log('[单挑] 翻牌后阶段 =', g.stage, ' firstToAct =', g.toAct, ' 期望 =', g.dealerIndex, g.toAct === g.dealerIndex ? '✅' : '❌');

// ---- 烧牌 + 公共牌数量 + 筹码守恒 ----
const g2 = new PokerGame({ numPlayers: 2, startingStack: 1000, bigBlind: 20 });
let ok = true;
for (let h = 0; h < 200 && !g2.gameOver; h++) {
  g2.startHand();
  const before = g2.players.reduce((s, p) => s + p.stack, 0) + g2.pot;
  autoPlayToEnd(g2);
  const after = g2.players.reduce((s, p) => s + p.stack, 0) + g2.pot;
  if (after !== 2000) { ok = false; console.log('❌ 筹码不守恒: 手', h, before, '->', after); break; }
  if (g2.stage === 'showdown') {
    if (g2.community.length !== 5) { ok = false; console.log('❌ 公共牌数 != 5:', g2.community.length); break; }
    if (g2.burns.length !== 3) { ok = false; console.log('❌ 烧牌数 != 3:', g2.burns.length); break; }
    // 亮牌顺序应覆盖所有未弃牌者
    const notFolded = g2.players.filter(p => !p.folded && !p.busted).length;
    if (g2.showOrder.length !== notFolded) { ok = false; console.log('❌ 亮牌顺序长度不对'); break; }
  }
}
console.log('[单挑] 200 手模拟：', ok ? '✅ 筹码守恒 / 烧牌3张 / 公共牌5张 / 亮牌顺序正确' : '❌ 见上');
