const { PokerGame } = require('./engine.js');

const NUM = 4, STACK = 1000;
const totalChips = NUM * STACK;
const g = new PokerGame({ numPlayers: NUM, startingStack: STACK, bigBlind: 20 });

let maxHands = 500, hands = 0, foldWins = 0, showdowns = 0;
let maxGuard = 0;

for (let h = 0; h < maxHands; h++) {
  g.startHand();
  if (g.gameOver) { console.log('游戏在第', h, '手结束'); break; }
  let guard = 0;
  while (!g.handOver) {
    guard++;
    if (guard > 5000) { console.error('⚠️ 死循环风险，第', h, '手未结束'); process.exit(1); }
    const p = g.players[g.toAct];
    const d = g.aiDecide(p);
    try {
      g.applyAction(d.action, d.amount);
    } catch (e) {
      console.error('动作异常:', e.message, 'stage=', g.stage, 'toAct=', g.toAct);
      process.exit(1);
    }
  }
  // 筹码守恒校验
  const sum = g.players.reduce((s, p) => s + p.stack, 0) + g.pot;
  if (sum !== totalChips) {
    console.error('❌ 筹码不守恒! 第', h, '手 sum=', sum, '期望', totalChips);
    process.exit(1);
  }
  if (g.lastResults && g.lastResults[0].reason === '其他人弃牌') foldWins++;
  else showdowns++;
  maxGuard = Math.max(maxGuard, guard);
  hands++;
  // 无人破产则继续；若有人破产但 >=2 人有筹码仍可继续
}

console.log('✅ 完成', hands, '手，无异常，筹码始终守恒');
console.log('   摊牌胜负:', showdowns, '| 弃牌收池:', foldWins);
console.log('   单手最大动作数:', maxGuard);
const stacks = g.players.map(p => p.name + ':' + p.stack).join('  ');
console.log('   最终筹码:', stacks);
