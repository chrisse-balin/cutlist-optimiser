'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../optimizer.js');

const item = (length, width, quantity = 1, label = undefined, id = undefined) => ({ id, length, width, quantity, label });
const totalQty = (items) => items.reduce((s, i) => s + O.normalizeQuantity(i.quantity), 0);
const EPS = 1e-6;

// ---------------------------------------------------------------- helpers ---

function assert1DValid(result, stockItems, partItems, kerf) {
  const placed = result.bins.reduce((s, b) => s + b.parts.length, 0);
  assert.equal(placed + result.unassigned.length, totalQty(partItems), 'every part is placed or unassigned');
  const stockIds = result.bins.map((b) => b.stockId);
  assert.equal(new Set(stockIds).size, stockIds.length, 'a stock piece is used at most once');
  assert.ok(result.bins.length <= totalQty(stockItems));
  result.bins.forEach((b) => {
    let end = -Infinity;
    b.parts.forEach((p) => {
      assert.equal(p.width, b.width, 'part width equals stock width');
      assert.ok(p.offset >= (end === -Infinity ? 0 : end + kerf) - EPS, 'kerf between parts');
      end = p.offset + p.length;
    });
    assert.ok(end <= b.stockLength + EPS, 'parts stay inside the stock');
    assert.ok(b.waste >= 0, 'waste is never negative');
  });
}

function assert2DValid(result, stockItems, partItems, kerf) {
  const placed = result.bins.reduce((s, b) => s + b.parts.length, 0);
  assert.equal(placed + result.unassigned.length, totalQty(partItems), 'every part is placed or unassigned');
  const ids = result.bins.flatMap((b) => b.parts.map((p) => p.id)).concat(result.unassigned.map((p) => p.id));
  assert.equal(new Set(ids).size, ids.length, 'no part duplicated');
  const stockIds = result.bins.map((b) => b.stockId);
  assert.equal(new Set(stockIds).size, stockIds.length, 'a sheet is used at most once');

  result.bins.forEach((b) => {
    b.parts.forEach((p) => {
      assert.ok(p.x >= -EPS && p.y >= -EPS, 'inside sheet (origin)');
      assert.ok(p.x + p.w <= b.stockLength + EPS && p.y + p.h <= b.stockWidth + EPS, 'inside sheet (extent)');
      const dims = [p.w, p.h].sort((a, c) => a - c).join('x');
      assert.equal(dims, [p.length, p.width].sort((a, c) => a - c).join('x'), 'placed size matches part');
      if (p.length !== p.width) assert.equal(p.rotated, p.w !== p.length, 'rotated flag matches orientation');
    });
    for (let i = 0; i < b.parts.length; i++) {
      for (let j = i + 1; j < b.parts.length; j++) {
        const a = b.parts[i];
        const c = b.parts[j];
        // parts must be separated by at least one kerf in x or in y
        const sepX = a.x + a.w + kerf <= c.x + EPS || c.x + c.w + kerf <= a.x + EPS;
        const sepY = a.y + a.h + kerf <= c.y + EPS || c.y + c.h + kerf <= a.y + EPS;
        assert.ok(sepX || sepY, `parts ${a.id} and ${c.id} overlap (incl. kerf)`);
      }
    }
  });
  const m = O.metrics2D(result);
  assert.ok(m.utilization >= 0 && m.utilization <= 100 + EPS, 'utilization within 0..100');
}

// --------------------------------------------------------------------- 1D ---

test('1D: simple fit on one stock piece', () => {
  const stock = [item(2400, 100, 1, 'Batten')];
  const parts = [item(800, 100, 2, 'Leg')];
  const r = O.solve1D(stock, parts, { kerf: 3 });
  assert.equal(r.bins.length, 1);
  assert.equal(r.unassigned.length, 0);
  assert.deepEqual(r.bins[0].parts.map((p) => p.offset), [0, 803]);
  assert.equal(r.bins[0].waste, 2400 - 1600 - 2 * 3);
  assert1DValid(r, stock, parts, 3);
});

test('1D: kerf is not needed after a part that ends at the stock end', () => {
  const r = O.solve1D([item(2000, 100)], [item(1000, 100), item(997, 100)], { kerf: 3 });
  assert.equal(r.unassigned.length, 0);
  assert.equal(r.bins.length, 1);
  assert.equal(r.bins[0].waste, 0);
});

test('1D: kerf prevents an overfull bin', () => {
  const r = O.solve1D([item(2000, 100, 2)], [item(1000, 100, 2)], { kerf: 3 });
  assert.equal(r.bins.length, 2, '1000+3+1000 > 2000');
  assert1DValid(r, [item(2000, 100, 2)], [item(1000, 100, 2)], 3);
});

test('1D: exact fit has zero (not negative) waste', () => {
  const r = O.solve1D([item(2000, 100)], [item(2000, 100)], { kerf: 3 });
  assert.equal(r.bins[0].waste, 0);
});

test('1D: parts are grouped by width; unknown width is unassigned', () => {
  const stock = [item(2400, 100, 1), item(3000, 150, 1)];
  const parts = [item(1000, 100, 2), item(1200, 150, 1), item(500, 80, 1, 'Odd')];
  const r = O.solve1D(stock, parts, { kerf: 3 });
  assert.equal(r.bins.length, 2);
  assert.equal(r.unassigned.length, 1);
  assert.equal(r.unassigned[0].label, 'Odd');
  assert.ok(r.unassigned[0].reason.startsWith(O.REASONS.NO_WIDTH));
  assert1DValid(r, stock, parts, 3);
});

test('1D: part longer than every stock of its width is unassigned', () => {
  const r = O.solve1D([item(2400, 100)], [item(2500, 100)], { kerf: 3 });
  assert.equal(r.unassigned.length, 1);
  assert.equal(r.unassigned[0].reason, O.REASONS.TOO_LONG);
});

test('1D: running out of stock reports insufficient quantity', () => {
  const stock = [item(1000, 100, 2)];
  const parts = [item(900, 100, 3)];
  const r = O.solve1D(stock, parts, { kerf: 3 });
  assert.equal(r.bins.length, 2);
  assert.equal(r.unassigned.length, 1);
  assert.equal(r.unassigned[0].reason, O.REASONS.NO_STOCK);
  assert1DValid(r, stock, parts, 3);
});

test('1D: multiple stock lengths – long part uses the long piece even if listed later', () => {
  const stock = [item(1000, 100, 1, 'short'), item(3000, 100, 1, 'long')];
  const r = O.solve1D(stock, [item(2000, 100)], { kerf: 3 });
  assert.equal(r.unassigned.length, 0);
  assert.equal(r.bins[0].stockLabel, 'long');
});

test('1D: quantity > 1 is expanded and all parts placed', () => {
  // 800+3+800+3+800 = 2406 > 2400, so at most two legs per piece -> 3 pieces are not enough
  const stock = [item(2400, 100, 4)];
  const parts = [item(800, 100, 4), item(600, 100, 2), item(450, 100, 6)];
  const r = O.solve1D(stock, parts, { kerf: 3 });
  assert.equal(r.unassigned.length, 0);
  assert.equal(r.bins.reduce((s, b) => s + b.parts.length, 0), 12);
  assert1DValid(r, stock, parts, 3);
});

test('1D: invalid input (0, negative, empty, NaN) is reported, never crashes', () => {
  const stock = [item(2400, 100, 1), item(-5, 100, 1), item('', '', 1)];
  const parts = [item(0, 100, 1, 'zero'), item('abc', 100, 1, 'nan'), item(500, 100, -2, 'negQty'), item(500, 100, 0, 'zeroQty')];
  const r = O.solve1D(stock, parts, { kerf: -1 });
  assert.equal(r.unassigned.length, 2);
  r.unassigned.forEach((u) => assert.equal(u.reason, O.REASONS.INVALID));
  assert.equal(r.bins.length, 0);
});

test('1D: random inputs keep all invariants', () => {
  const rnd = O.mulberry32(42);
  for (let t = 0; t < 200; t++) {
    const widths = [60, 100, 150];
    const stock = widths.map((w) => item(1000 + Math.floor(rnd() * 3000), w, 1 + Math.floor(rnd() * 3)));
    const parts = Array.from({ length: 1 + Math.floor(rnd() * 8) }, () =>
      item(50 + Math.floor(rnd() * 2500), widths[Math.floor(rnd() * 3)], 1 + Math.floor(rnd() * 4)));
    const kerf = Math.floor(rnd() * 6);
    assert1DValid(O.solve1D(stock, parts, { kerf }), stock, parts, kerf);
  }
});

// --------------------------------------------------------------------- 2D ---

test('2D: single part on a sheet', () => {
  const stock = [item(2500, 1250, 1, 'Ply')];
  const parts = [item(1200, 700, 1, 'Top')];
  const r = O.solve2D(stock, parts, { kerf: 3, allowRotation: true });
  assert.equal(r.bins.length, 1);
  assert.equal(r.unassigned.length, 0);
  const p = r.bins[0].parts[0];
  assert.deepEqual([p.x, p.y], [0, 0]);
  assert2DValid(r, stock, parts, 3);
});

test('2D: parts that fill the sheet exactly with kerf all fit', () => {
  // 4 x 500 + 3 kerfs of 3mm = 2009 along length; 2 x 600 + 1 kerf = 1203 along width
  const stock = [item(2009, 1203, 1)];
  const parts = [item(500, 600, 8)];
  const r = O.solve2D(stock, parts, { kerf: 3, allowRotation: false });
  assert.equal(r.unassigned.length, 0);
  assert.equal(r.bins.length, 1);
  assert2DValid(r, stock, parts, 3);
});

test('2D: two parts separated by exactly one kerf', () => {
  const r = O.solve2D([item(1003, 1000)], [item(500, 1000, 2)], { kerf: 3, allowRotation: false });
  assert.equal(r.unassigned.length, 0);
});

test('2D: rotation off – part only fitting rotated is unassigned', () => {
  const stock = [item(1000, 2000)];
  const parts = [item(1800, 900)];
  const off = O.solve2D(stock, parts, { kerf: 3, allowRotation: false });
  assert.equal(off.unassigned.length, 1);
  assert.equal(off.unassigned[0].reason, O.REASONS.TOO_BIG);
  const on = O.solve2D(stock, parts, { kerf: 3, allowRotation: true });
  assert.equal(on.unassigned.length, 0);
  assert.equal(on.bins[0].parts[0].rotated, true);
  assert2DValid(on, stock, parts, 3);
});

test('2D: rotation off never rotates', () => {
  const stock = [item(2500, 1250, 2)];
  const parts = [item(400, 300, 10), item(1200, 200, 3)];
  const r = O.optimize2D(stock, parts, { kerf: 3, allowRotation: false }, { random: O.mulberry32(1), generations: 20 });
  r.bins.forEach((b) => b.parts.forEach((p) => assert.equal(p.rotated, false)));
  assert2DValid(r, stock, parts, 3);
});

test('2D: part bigger than every sheet is unassigned with the right reason', () => {
  const r = O.solve2D([item(2500, 1250)], [item(3000, 1300)], { kerf: 3, allowRotation: true });
  assert.equal(r.unassigned.length, 1);
  assert.equal(r.unassigned[0].reason, O.REASONS.TOO_BIG);
});

test('2D: running out of sheets reports insufficient quantity', () => {
  const r = O.solve2D([item(1000, 1000, 1)], [item(900, 900, 2)], { kerf: 3, allowRotation: true });
  assert.equal(r.unassigned.length, 1);
  assert.equal(r.unassigned[0].reason, O.REASONS.NO_STOCK);
});

test('2D: mixed sheet sizes – part that only fits the second sheet is placed', () => {
  const stock = [item(600, 600, 1, 'offcut'), item(2000, 1000, 1, 'full')];
  const r = O.solve2D(stock, [item(1000, 500)], { kerf: 3, allowRotation: false });
  assert.equal(r.unassigned.length, 0);
  assert.equal(r.bins[0].stockLabel, 'full');
});

test('2D: small part prefers the smaller sheet (offcut first)', () => {
  const stock = [item(2000, 1000, 1, 'full'), item(600, 600, 1, 'offcut')];
  const r = O.solve2D(stock, [item(500, 500)], { kerf: 3, allowRotation: false });
  assert.equal(r.bins[0].stockLabel, 'offcut');
});

test('2D: default example from the app places everything on one sheet', () => {
  const stock = [item(2500, 1250, 1)];
  const parts = [item(1200, 700, 1), item(438, 700, 2), item(182, 700, 3), item(585, 838, 1)];
  const r = O.optimize2D(stock, parts, { kerf: 3, allowRotation: true }, { random: O.mulberry32(7) });
  assert.equal(r.unassigned.length, 0);
  assert2DValid(r, stock, parts, 3);
});

test('2D: random inputs keep all invariants (heuristic and GA)', () => {
  const rnd = O.mulberry32(123);
  for (let t = 0; t < 60; t++) {
    const stock = [item(1000 + Math.floor(rnd() * 1500), 500 + Math.floor(rnd() * 1000), 1 + Math.floor(rnd() * 3))];
    if (rnd() < 0.5) stock.push(item(300 + Math.floor(rnd() * 700), 300 + Math.floor(rnd() * 700), 1));
    const parts = Array.from({ length: 1 + Math.floor(rnd() * 6) }, () =>
      item(20 + Math.floor(rnd() * 1200), 20 + Math.floor(rnd() * 900), 1 + Math.floor(rnd() * 4)));
    const kerf = Math.floor(rnd() * 5);
    const allowRotation = rnd() < 0.5;
    const heuristic = O.solve2D(stock, parts, { kerf, allowRotation });
    assert2DValid(heuristic, stock, parts, kerf);
    const ga = O.optimize2D(stock, parts, { kerf, allowRotation }, { random: O.mulberry32(t), generations: 15 });
    assert2DValid(ga, stock, parts, kerf);
    const goal = Object.keys(O.GOALS)[t % 3];
    const h2 = O.solve2D(stock, parts, { kerf, allowRotation, goal });
    const ga2 = O.optimize2D(stock, parts, { kerf, allowRotation, goal }, { random: O.mulberry32(t), generations: 15 });
    assert.ok(O.compare2D(ga, heuristic) <= 0, 'GA result is never worse than the first heuristic');
    assert.ok(O.compare2D(ga2, h2, goal) <= 0, `GA is never worse than the heuristic for goal ${goal}`);
    [heuristic, ga, h2, ga2].forEach((r) => r.bins.forEach((b) => assert.ok(b.guillotine, 'layout is guillotine-cuttable')));
  }
});

test('2D: optimizer step() reports progress and terminates', () => {
  const opt = O.createOptimizer2D([item(2500, 1250, 3)], [item(400, 300, 12), item(700, 500, 4)], { kerf: 3, allowRotation: true },
    { random: O.mulberry32(5), generations: 10 });
  let last;
  let steps = 0;
  do {
    last = opt.step();
    steps++;
  } while (!last.done && steps < 100);
  assert.ok(last.done);
  assert.ok(last.generation <= 10);
  assert.ok(last.metrics.utilization > 0);
});

test('2D: invalid parts are reported, not packed', () => {
  const r = O.solve2D([item(2500, 1250)], [item(0, 100), item(-1, 100), item('', '')], { kerf: 3, allowRotation: true });
  assert.equal(r.unassigned.length, 3);
  r.unassigned.forEach((u) => assert.equal(u.reason, O.REASONS.INVALID));
});

// ------------------------------------------------- cut analysis & goals ---

const STAIR_PARTS = [item(1200, 700, 1, 'Deckel'), item(438, 700, 2, 'Stufen'), item(182, 700, 3, 'Doppel'), item(585, 838, 1, 'Wange')];

test('cut analysis: one part in the corner leaves the larger offcut', () => {
  const bin = { stockLength: 2500, stockWidth: 1250, parts: [{ x: 0, y: 0, w: 1000, h: 400 }] };
  const a = O.analyzeSheet(bin, 0);
  assert.equal(a.guillotine, true);
  assert.equal(a.stages, 2);
  assert.equal(a.cuts, 2);
  const largest = a.offcuts.reduce((m, r) => (r.w * r.h > m.w * m.h ? r : m));
  assert.deepEqual([largest.w, largest.h], [2500, 850], 'horizontal cut first keeps a full-length offcut');
});

test('cut analysis: a part filling the sheet needs no cut', () => {
  const a = O.analyzeSheet({ stockLength: 1000, stockWidth: 500, parts: [{ x: 0, y: 0, w: 1000, h: 500 }] }, 3);
  assert.deepEqual([a.stages, a.cuts, a.offcuts.length], [0, 0, 0]);
});

test('cut analysis: kerf strips are not reported as offcuts', () => {
  const r = O.solve2D([item(1003, 500)], [item(500, 500, 2)], { kerf: 3, allowRotation: false });
  assert.equal(r.bins[0].cuts, 1);
  assert.equal(r.bins[0].offcuts.length, 0);
});

test('offcuts narrower than the minimum are flagged as not usable', () => {
  const r = O.solve2D([item(1000, 1000)], [item(950, 1000)], { kerf: 0, allowRotation: false, minOffcut: 100 });
  assert.equal(r.bins[0].offcuts.length, 1);
  assert.equal(r.bins[0].offcuts[0].usable, false);
  assert.equal(O.metrics2D(r).largestOffcutArea, 0);
  const r2 = O.solve2D([item(1000, 1000)], [item(950, 1000)], { kerf: 0, allowRotation: false, minOffcut: 40 });
  assert.equal(r2.bins[0].offcuts[0].usable, true);
});

test('strip packer: random inputs keep all invariants and need at most 3 stages plus trimming', () => {
  const rnd = O.mulberry32(99);
  for (let t = 0; t < 80; t++) {
    const stock = O.expandItems([item(1000 + Math.floor(rnd() * 1500), 500 + Math.floor(rnd() * 1000), 1 + Math.floor(rnd() * 3))], 'S');
    const partItems = Array.from({ length: 1 + Math.floor(rnd() * 6) }, () =>
      item(20 + Math.floor(rnd() * 1200), 20 + Math.floor(rnd() * 900), 1 + Math.floor(rnd() * 4)));
    const kerf = Math.floor(rnd() * 5);
    const allowRotation = rnd() < 0.5;
    ['rows', 'columns'].forEach((stripDirection) => {
      const r = O.packStrips(O.expandItems(partItems, 'P'), stock, { kerf, allowRotation, stripDirection });
      assert2DValid(r, stock, partItems, kerf);
      r.bins.forEach((b) => {
        assert.ok(b.guillotine, 'strip layout is guillotine');
        // 3 stages; a part narrower than its stack needs one extra trim cut
        assert.ok(b.stages <= 4, `strip layout needs ${b.stages} stages`);
      });
    });
  }
});

test('2D: stair example fits one sheet with few stages and a large offcut for every goal', () => {
  const stock = [item(2500, 1250, 1)];
  Object.keys(O.GOALS).forEach((goal) => {
    const r = O.optimize2D(stock, STAIR_PARTS, { kerf: 3, allowRotation: true, goal }, { random: O.mulberry32(7) });
    assert2DValid(r, stock, STAIR_PARTS, 3);
    const m = O.metrics2D(r);
    assert.equal(m.unassignedCount, 0, goal);
    assert.ok(m.stages <= 3, `${goal}: ${m.stages} stages`);
    assert.ok(m.largestOffcutArea >= 800 * 600, `${goal}: largest offcut only ${m.largestOffcutArea} mm²`);
  });
});

test('compare2D: the goal decides between simple cutting and large offcuts', () => {
  const base = { unassignedCount: 0, usedArea: 1, stockArea: 2, sheetsUsed: 1, usableOffcutArea: 0 };
  const twoStagesSmallRest = { metrics: { ...base, stages: 2, cuts: 6, largestOffcutArea: 100 } };
  const threeStagesBigRest = { metrics: { ...base, stages: 3, cuts: 9, largestOffcutArea: 900 } };
  const fourStagesHugeRest = { metrics: { ...base, stages: 4, cuts: 9, largestOffcutArea: 1000 } };
  assert.ok(O.compare2D(twoStagesSmallRest, threeStagesBigRest, 'simple') < 0);
  assert.ok(O.compare2D(threeStagesBigRest, twoStagesSmallRest, 'offcuts') < 0);
  assert.ok(O.compare2D(threeStagesBigRest, twoStagesSmallRest, 'balanced') < 0, 'balanced: up to 3 stages count as equal');
  assert.ok(O.compare2D(threeStagesBigRest, fourStagesHugeRest, 'balanced') < 0, 'balanced: more than 3 stages is worse');
  assert.ok(O.compare2D(fourStagesHugeRest, threeStagesBigRest, 'offcuts') < 0);
  const moreParts = { metrics: { ...base, unassignedCount: 0, stages: 9, cuts: 99, largestOffcutArea: 0 } };
  const fewerParts = { metrics: { ...base, unassignedCount: 1, stages: 1, cuts: 1, largestOffcutArea: 5000 } };
  Object.keys(O.GOALS).forEach((g) => assert.ok(O.compare2D(moreParts, fewerParts, g) < 0, 'placing parts always wins'));
});

test('expandItems: quantity handling and default labels', () => {
  const e = O.expandItems([{ id: 7, length: 10, width: 10, quantity: '3' }, { id: 8, length: 10, width: 10, quantity: 0 }], 'Part');
  assert.equal(e.length, 3);
  assert.deepEqual(e.map((x) => x.id), ['7-0', '7-1', '7-2']);
  assert.equal(e[0].label, 'Part 1');
  assert.equal(e[0].originalId, 7);
});
