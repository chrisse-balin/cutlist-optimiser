/*
 * Cutlist optimizer – pure algorithm module (no React, no DOM).
 *
 * Works as a plain browser <script> (exposes window.CutlistOptimizer)
 * and as a Node module (module.exports), so it can be unit tested with
 * `node --test`.
 *
 * Conventions
 *  - All dimensions are in mm.
 *  - Input items: { id, length, width, quantity, label }.
 *  - 1D: parts are matched to stock of the SAME width and packed along length.
 *  - 2D: x runs along the stock LENGTH, y along the stock WIDTH.
 *    A placed part gets { x, y, w, h, rotated } where w is its extent along x.
 *  - Kerf is consumed only BETWEEN a part and the remaining material; a part
 *    may touch the stock edge without extra kerf.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CutlistOptimizer = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EPS = 1e-6;

  const REASONS = {
    INVALID: 'Ungültige Maße (Länge und Breite müssen positive Zahlen sein)',
    NO_WIDTH: 'Kein Material mit passender Breite',
    TOO_LONG: 'Länger als das längste Material dieser Breite',
    TOO_BIG: 'Größer als jede verfügbare Platte',
    NO_STOCK: 'Material reicht nicht aus',
  };

  // ---------------------------------------------------------------------------
  // Input normalisation
  // ---------------------------------------------------------------------------

  const toNumber = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));
  const isPositive = (v) => Number.isFinite(v) && v > 0;

  const normalizeKerf = (kerf) => {
    const k = toNumber(kerf);
    return Number.isFinite(k) && k > 0 ? k : 0;
  };

  const normalizeQuantity = (q) => {
    if (q === undefined || q === null || q === '') return 1;
    const n = Math.floor(Number(q));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  /**
   * Explode items by quantity into individual instances.
   * Each instance keeps originalId (for colouring/grouping) and a unique id.
   */
  const expandItems = (items, kind) => {
    const out = [];
    (items || []).forEach((item, index) => {
      const qty = normalizeQuantity(item.quantity);
      const length = toNumber(item.length);
      const width = toNumber(item.width);
      const originalId = item.id !== undefined ? item.id : index;
      const label = item.label ? String(item.label) : `${kind} ${index + 1}`;
      for (let i = 0; i < qty; i++) {
        out.push({
          ...item,
          id: `${originalId}-${i}`,
          originalId,
          label,
          length,
          width,
          valid: isPositive(length) && isPositive(width),
        });
      }
    });
    return out;
  };

  const stripInternal = ({ valid, ...rest }) => rest;

  // ---------------------------------------------------------------------------
  // 1D – best fit decreasing per width group
  // ---------------------------------------------------------------------------

  const widthKey = (w) => Math.round(w * 100) / 100;

  /**
   * @returns {{ bins: Array, unassigned: Array }}
   * bin: { id, stockId, stockLabel, stockLength, width, parts:[{...part, offset}],
   *        usedLength, waste }
   */
  const solve1D = (stockItems, partItems, options = {}) => {
    const kerf = normalizeKerf(options.kerf);
    const stock = expandItems(stockItems, 'Material').filter((s) => s.valid);
    const parts = expandItems(partItems, 'Teil');

    const stockByWidth = new Map();
    stock.forEach((s) => {
      const k = widthKey(s.width);
      if (!stockByWidth.has(k)) stockByWidth.set(k, []);
      stockByWidth.get(k).push(s);
    });

    const unassigned = [];
    const groups = new Map();

    parts.forEach((p) => {
      if (!p.valid) return unassigned.push({ ...stripInternal(p), reasonCode: 'INVALID', reason: REASONS.INVALID });
      const k = widthKey(p.width);
      const group = stockByWidth.get(k);
      if (!group) {
        return unassigned.push({ ...stripInternal(p), reasonCode: 'NO_WIDTH', reason: `${REASONS.NO_WIDTH} (${p.width} mm)` });
      }
      const longest = Math.max(...group.map((s) => s.length));
      if (p.length > longest + EPS) {
        return unassigned.push({ ...stripInternal(p), reasonCode: 'TOO_LONG', reason: REASONS.TOO_LONG });
      }
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    });

    const bins = [];

    groups.forEach((groupParts, k) => {
      const remainingStock = [...stockByWidth.get(k)];
      const groupBins = [];
      const sorted = [...groupParts].sort((a, b) => b.length - a.length);

      // free length available for one more part (no kerf needed after the last part)
      const free = (bin) => bin.stockLength - bin.sum - bin.parts.length * kerf;

      sorted.forEach((part) => {
        let best = null;
        let bestLeft = Infinity;
        groupBins.forEach((bin) => {
          const left = free(bin) - part.length;
          if (left >= -EPS && left < bestLeft) {
            best = bin;
            bestLeft = left;
          }
        });

        if (!best) {
          // open the shortest remaining stock piece that can hold the part
          let idx = -1;
          remainingStock.forEach((s, i) => {
            if (s.length + EPS >= part.length && (idx === -1 || s.length < remainingStock[idx].length)) idx = i;
          });
          if (idx === -1) {
            unassigned.push({ ...stripInternal(part), reasonCode: 'NO_STOCK', reason: REASONS.NO_STOCK });
            return;
          }
          const s = remainingStock.splice(idx, 1)[0];
          best = {
            id: `1d-${bins.length + groupBins.length}`,
            stockId: s.id,
            stockLabel: s.label,
            stockLength: s.length,
            width: s.width,
            parts: [],
            sum: 0,
          };
          groupBins.push(best);
        }

        const offset = best.sum + best.parts.length * kerf;
        best.parts.push({ ...stripInternal(part), offset });
        best.sum += part.length;
      });

      groupBins.forEach((bin) => {
        const n = bin.parts.length;
        const afterLast = bin.stockLength - bin.sum - (n - 1) * kerf;
        // the cut after the last part costs one kerf (unless the part ends at the stock end)
        const waste = Math.max(0, afterLast - kerf);
        const { sum, ...rest } = bin;
        bins.push({ ...rest, usedLength: sum, waste });
      });
    });

    return { bins, unassigned };
  };

  const metrics1D = (result) => {
    const stockLength = result.bins.reduce((s, b) => s + b.stockLength, 0);
    const usedLength = result.bins.reduce((s, b) => s + b.usedLength, 0);
    const utilization = stockLength > 0 ? (usedLength / stockLength) * 100 : 0;
    return {
      binsUsed: result.bins.length,
      stockLength,
      usedLength,
      utilization,
      wastePercentage: stockLength > 0 ? 100 - utilization : 0,
      unassignedCount: result.unassigned.length,
    };
  };

  // ---------------------------------------------------------------------------
  // 2D – guillotine packing (best area fit)
  // ---------------------------------------------------------------------------

  const orientations = (part, allowRotation, preferRotated) => {
    const normal = { w: part.length, h: part.width, rotated: false };
    if (!allowRotation || Math.abs(part.length - part.width) < EPS) return [normal];
    const rotated = { w: part.width, h: part.length, rotated: true };
    return preferRotated ? [rotated, normal] : [normal, rotated];
  };

  const fitsIn = (w, h, rw, rh) => w <= rw + EPS && h <= rh + EPS;

  /**
   * Place a w×h part in the top-left corner of free rectangle `rect` and
   * replace it by up to two guillotine remainders. The split direction is
   * chosen so that the larger remainder is as large as possible.
   */
  const placeInRect = (sheet, rectIndex, w, h, kerf) => {
    const r = sheet.freeRects[rectIndex];
    sheet.freeRects.splice(rectIndex, 1);
    const rightW = r.w - w - kerf;
    const bottomH = r.h - h - kerf;

    // Vertical first cut: right remainder spans full height.
    const vRight = rightW > EPS ? rightW * r.h : 0;
    const vBottom = bottomH > EPS ? w * bottomH : 0;
    // Horizontal first cut: bottom remainder spans full width.
    const hRight = rightW > EPS ? rightW * h : 0;
    const hBottom = bottomH > EPS ? r.w * bottomH : 0;
    const vertical = Math.max(vRight, vBottom) >= Math.max(hRight, hBottom);

    if (rightW > EPS) {
      sheet.freeRects.push({ x: r.x + w + kerf, y: r.y, w: rightW, h: vertical ? r.h : h });
    }
    if (bottomH > EPS) {
      sheet.freeRects.push({ x: r.x, y: r.y + h + kerf, w: vertical ? w : r.w, h: bottomH });
    }
    return { x: r.x, y: r.y };
  };

  /**
   * Pack parts (already expanded, in the given order) onto stock pieces.
   * rotationPrefs[i] === true means "try rotated first" for parts[i].
   */
  const pack2D = (parts, stockPieces, options = {}) => {
    const kerf = normalizeKerf(options.kerf);
    const allowRotation = !!options.allowRotation;
    const prefs = options.rotationPrefs || [];
    const unopened = stockPieces.filter((s) => s.valid !== false && isPositive(s.length) && isPositive(s.width));
    const allStock = [...unopened];
    const sheets = [];
    const unassigned = [];

    parts.forEach((part, i) => {
      if (part.valid === false || !isPositive(part.length) || !isPositive(part.width)) {
        unassigned.push({ ...stripInternal(part), reasonCode: 'INVALID', reason: REASONS.INVALID });
        return;
      }
      const oris = orientations(part, allowRotation, !!prefs[i]);

      // 1) best area fit among open sheets
      let best = null;
      sheets.forEach((sheet) => {
        sheet.freeRects.forEach((r, ri) => {
          oris.forEach((o) => {
            if (!fitsIn(o.w, o.h, r.w, r.h)) return;
            const score = r.w * r.h - o.w * o.h;
            const shortLeft = Math.min(r.w - o.w, r.h - o.h);
            if (!best || score < best.score - EPS || (Math.abs(score - best.score) <= EPS && shortLeft < best.shortLeft)) {
              best = { sheet, ri, o, score, shortLeft };
            }
          });
        });
      });

      // 2) otherwise open the smallest unopened stock piece that fits
      if (!best) {
        let pick = -1;
        let pickOri = null;
        unopened.forEach((s, si) => {
          const o = oris.find((oo) => fitsIn(oo.w, oo.h, s.length, s.width));
          if (!o) return;
          if (pick === -1 || s.length * s.width < unopened[pick].length * unopened[pick].width) {
            pick = si;
            pickOri = o;
          }
        });
        if (pick === -1) {
          const fitsAny = allStock.some((s) => oris.some((o) => fitsIn(o.w, o.h, s.length, s.width)));
          unassigned.push({ ...stripInternal(part), reasonCode: fitsAny ? 'NO_STOCK' : 'TOO_BIG', reason: fitsAny ? REASONS.NO_STOCK : REASONS.TOO_BIG });
          return;
        }
        const s = unopened.splice(pick, 1)[0];
        const sheet = {
          id: `2d-${sheets.length}`,
          stockId: s.id,
          stockLabel: s.label,
          stockLength: s.length,
          stockWidth: s.width,
          parts: [],
          freeRects: [{ x: 0, y: 0, w: s.length, h: s.width }],
        };
        sheets.push(sheet);
        best = { sheet, ri: 0, o: pickOri };
      }

      const pos = placeInRect(best.sheet, best.ri, best.o.w, best.o.h, kerf);
      best.sheet.parts.push({ ...stripInternal(part), x: pos.x, y: pos.y, w: best.o.w, h: best.o.h, rotated: best.o.rotated });
    });

    const bins = sheets.map(({ freeRects, ...rest }) => rest);
    return finalize2D({ bins, unassigned }, kerf, options.minOffcut);
  };

  /**
   * Strip packer (3-stage guillotine, like a panel saw):
   *   stage 1 cuts the sheet into strips across its full length,
   *   stage 2 cuts each strip into stacks,
   *   stage 3 cuts each stack into parts.
   * stripDirection 'rows' = strips run along the sheet length (x),
   * 'columns' = strips run along the sheet width (y).
   */
  const packStrips = (parts, stockPieces, options = {}) => {
    const kerf = normalizeKerf(options.kerf);
    const allowRotation = !!options.allowRotation;
    const prefs = options.rotationPrefs || [];
    const transpose = options.stripDirection === 'columns';
    const unopened = stockPieces.filter((s) => s.valid !== false && isPositive(s.length) && isPositive(s.width));
    const allStock = [...unopened];
    const sheets = [];
    const unassigned = [];
    // Local coordinates: u along the strips, v across them.
    const local = (o) => (transpose ? { w: o.h, h: o.w, rotated: o.rotated } : o);
    const after = (used) => (used > EPS ? used + kerf : 0);

    parts.forEach((part, i) => {
      if (part.valid === false || !isPositive(part.length) || !isPositive(part.width)) {
        unassigned.push({ ...stripInternal(part), reasonCode: 'INVALID', reason: REASONS.INVALID });
        return;
      }
      const oris = orientations(part, allowRotation, !!prefs[i]).map(local);
      let best = null;
      const consider = (score, apply) => {
        if (!best || score < best.score - EPS) best = { score, apply };
      };
      const put = (sheet, u, v, o) => sheet.parts.push({ part, u, v, o });

      sheets.forEach((sheet) => {
        sheet.strips.forEach((strip) => {
          // stage 3: on top of an existing stack
          strip.stacks.forEach((stack) => {
            oris.forEach((o) => {
              const v = stack.v + after(stack.used);
              if (o.w > stack.w + EPS || v + o.h > strip.v + strip.h + EPS) return;
              consider((stack.w - o.w) * o.h, () => {
                put(sheet, stack.u, v, o);
                stack.used = v + o.h - stack.v;
              });
            });
          });
          // stage 2: new stack at the end of the strip
          oris.forEach((o) => {
            const u = after(strip.used);
            if (o.h > strip.h + EPS || u + o.w > sheet.U + EPS) return;
            consider((strip.h - o.h) * o.w, () => {
              put(sheet, u, strip.v, o);
              strip.stacks.push({ u, v: strip.v, w: o.w, used: o.h });
              strip.used = u + o.w;
            });
          });
        });
        // stage 1: new strip on an open sheet; its height is set by this part
        oris.forEach((o, oi) => {
          const v = after(sheet.usedV);
          if (o.w > sheet.U + EPS || v + o.h > sheet.V + EPS) return;
          consider(1e15 + oi, () => {
            put(sheet, 0, v, o);
            sheet.strips.push({ v, h: o.h, used: o.w, stacks: [{ u: 0, v, w: o.w, used: o.h }] });
            sheet.usedV = v + o.h;
          });
        });
      });

      if (!best) {
        // open the smallest unopened stock piece that fits (respecting the rotation preference)
        let pick = -1;
        let pickOri = null;
        unopened.forEach((s, si) => {
          const U = transpose ? s.width : s.length;
          const V = transpose ? s.length : s.width;
          const o = oris.find((oo) => fitsIn(oo.w, oo.h, U, V));
          if (!o) return;
          if (pick === -1 || s.length * s.width < unopened[pick].length * unopened[pick].width) {
            pick = si;
            pickOri = o;
          }
        });
        if (pick === -1) {
          const fitsAny = allStock.some((s) => oris.some((o) => fitsIn(o.w, o.h, transpose ? s.width : s.length, transpose ? s.length : s.width)));
          unassigned.push({ ...stripInternal(part), reasonCode: fitsAny ? 'NO_STOCK' : 'TOO_BIG', reason: fitsAny ? REASONS.NO_STOCK : REASONS.TOO_BIG });
          return;
        }
        const s = unopened.splice(pick, 1)[0];
        const sheet = {
          id: `2d-${sheets.length}`,
          stockId: s.id,
          stockLabel: s.label,
          stockLength: s.length,
          stockWidth: s.width,
          U: transpose ? s.width : s.length,
          V: transpose ? s.length : s.width,
          usedV: 0,
          strips: [],
          parts: [],
        };
        sheets.push(sheet);
        const o = pickOri;
        put(sheet, 0, 0, o);
        sheet.strips.push({ v: 0, h: o.h, used: o.w, stacks: [{ u: 0, v: 0, w: o.w, used: o.h }] });
        sheet.usedV = o.h;
        return;
      }
      best.apply();
    });

    const bins = sheets.map((sh) => ({
      id: sh.id,
      stockId: sh.stockId,
      stockLabel: sh.stockLabel,
      stockLength: sh.stockLength,
      stockWidth: sh.stockWidth,
      parts: sh.parts.map(({ part, u, v, o }) => {
        const g = transpose ? { x: v, y: u, w: o.h, h: o.w } : { x: u, y: v, w: o.w, h: o.h };
        return { ...stripInternal(part), ...g, rotated: o.rotated };
      }),
    }));
    return finalize2D({ bins, unassigned }, kerf, options.minOffcut);
  };

  // ---------------------------------------------------------------------------
  // 2D – cut analysis: rebuild the guillotine cut tree of a finished sheet
  // ---------------------------------------------------------------------------

  const DEFAULT_MIN_OFFCUT = 100;

  /**
   * Reconstruct how a sheet is sawn. Each stage is a set of parallel cuts
   * across the whole current piece; directions alternate between stages.
   * Where both directions are possible, the variant with fewer stages and then
   * the larger offcut wins.
   * @returns {{ stages, cuts, offcuts:[{x,y,w,h}], guillotine:boolean }}
   */
  const analyzeSheet = (bin, kerf) => {
    const items = bin.parts.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h }));
    const memo = new Map();
    const biggest = (offcuts) => offcuts.reduce((m, r) => Math.max(m, r.w * r.h), 0);
    const better = (a, b) => {
      if (a.guillotine !== b.guillotine) return a.guillotine;
      if (a.stages !== b.stages) return a.stages < b.stages;
      const d = biggest(a.offcuts) - biggest(b.offcuts);
      if (Math.abs(d) > EPS) return d > 0;
      return a.cuts < b.cuts;
    };

    const findCuts = (list, axis, lo, hi) => {
      const start = (it) => (axis === 'x' ? it.x : it.y);
      const size = (it) => (axis === 'x' ? it.w : it.h);
      const cands = [];
      list.forEach((it) => {
        const s = start(it);
        const e = s + size(it);
        if (e + kerf < hi - EPS) cands.push([e, e + kerf]);
        if (s - kerf > lo + EPS) cands.push([s - kerf, s]);
      });
      const valid = cands
        .filter(([a, b]) => list.every((it) => start(it) + size(it) <= a + EPS || start(it) >= b - EPS))
        .sort((p, q) => p[0] - q[0]);
      const out = [];
      valid.forEach((c) => {
        const prev = out[out.length - 1];
        if (prev && (c[0] < prev[1] - EPS || Math.abs(c[0] - prev[0]) < EPS)) return;
        out.push(c);
      });
      return out;
    };

    const solve = (rx, ry, rw, rh, list) => {
      if (list.length === 0) {
        const offcuts = rw > EPS && rh > EPS ? [{ x: rx, y: ry, w: rw, h: rh }] : [];
        return { stages: 0, cuts: 0, offcuts, guillotine: true };
      }
      if (list.length === 1 && list[0].w >= rw - kerf - EPS && list[0].h >= rh - kerf - EPS) {
        return { stages: 0, cuts: 0, offcuts: [], guillotine: true };
      }
      const key = `${rx.toFixed(3)}|${ry.toFixed(3)}|${rw.toFixed(3)}|${rh.toFixed(3)}`;
      if (memo.has(key)) return memo.get(key);

      let best = null;
      ['x', 'y'].forEach((axis) => {
        const lo = axis === 'x' ? rx : ry;
        const hi = lo + (axis === 'x' ? rw : rh);
        const cuts = findCuts(list, axis, lo, hi);
        if (cuts.length === 0) return;
        const bounds = [];
        let from = lo;
        cuts.forEach(([a, b]) => {
          bounds.push([from, a]);
          from = b;
        });
        bounds.push([from, hi]);
        const res = { stages: 0, cuts: cuts.length, offcuts: [], guillotine: true };
        bounds.forEach(([a, b]) => {
          const inSlab = list.filter((it) => {
            const s = axis === 'x' ? it.x : it.y;
            return s >= a - EPS && s < b - EPS;
          });
          const child = axis === 'x' ? solve(a, ry, b - a, rh, inSlab) : solve(rx, a, rw, b - a, inSlab);
          res.stages = Math.max(res.stages, child.stages);
          res.cuts += child.cuts;
          res.offcuts = res.offcuts.concat(child.offcuts);
          res.guillotine = res.guillotine && child.guillotine;
        });
        res.stages += 1;
        if (!best || better(res, best)) best = res;
      });
      if (!best) best = { stages: 0, cuts: 0, offcuts: [], guillotine: false };
      memo.set(key, best);
      return best;
    };

    return solve(0, 0, bin.stockLength, bin.stockWidth, items);
  };

  /** Attach cut analysis (stages, cuts, offcuts with usable flag) to every sheet. */
  const finalize2D = (result, kerf, minOffcut) => {
    const min = Number.isFinite(Number(minOffcut)) && Number(minOffcut) >= 0 ? Number(minOffcut) : DEFAULT_MIN_OFFCUT;
    result.bins.forEach((bin) => {
      const a = analyzeSheet(bin, kerf);
      bin.stages = a.stages;
      bin.cuts = a.cuts;
      bin.guillotine = a.guillotine;
      bin.offcuts = a.offcuts.map((r) => ({ ...r, usable: Math.min(r.w, r.h) >= min - EPS }));
    });
    result.minOffcut = min;
    return result;
  };

  const metrics2D = (result) => {
    const stockArea = result.bins.reduce((s, b) => s + b.stockLength * b.stockWidth, 0);
    const usedArea = result.bins.reduce((s, b) => s + b.parts.reduce((ps, p) => ps + p.w * p.h, 0), 0);
    const utilization = stockArea > 0 ? (usedArea / stockArea) * 100 : 0;
    let largestOffcut = null;
    let largestPerSheet = 0;
    let usableOffcutArea = 0;
    result.bins.forEach((b) => {
      let sheetMax = 0;
      (b.offcuts || []).forEach((r) => {
        if (!r.usable) return;
        const area = r.w * r.h;
        usableOffcutArea += area;
        sheetMax = Math.max(sheetMax, area);
        if (!largestOffcut || area > largestOffcut.w * largestOffcut.h) largestOffcut = r;
      });
      largestPerSheet += sheetMax;
    });
    return {
      sheetsUsed: result.bins.length,
      stockArea,
      usedArea,
      utilization,
      wastePercentage: stockArea > 0 ? 100 - utilization : 0,
      unassignedCount: result.unassigned.length,
      cuts: result.bins.reduce((s, b) => s + (b.cuts || 0), 0),
      stages: result.bins.reduce((m, b) => Math.max(m, b.guillotine === false ? Infinity : b.stages || 0), 0),
      largestOffcut,
      largestOffcutArea: largestPerSheet,
      usableOffcutArea,
    };
  };

  /** Optimisation goals selectable in the UI. */
  const GOALS = {
    balanced: 'Ausgewogen',
    simple: 'Einfach sägen',
    offcuts: 'Große Reste',
  };

  /**
   * Compare two 2D results. Negative => a is better.
   * Always first: more parts placed, more area placed, less stock area, fewer sheets.
   * Then by goal:
   *  - simple:   fewer cut stages, fewer cuts, larger offcut
   *  - offcuts:  larger usable offcut, more usable offcut area, fewer stages, fewer cuts
   *  - balanced: at most 3 stages (panel saw), then larger usable offcut, fewer cuts
   */
  const compare2D = (a, b, goal = 'balanced') => {
    const ma = a.metrics || metrics2D(a);
    const mb = b.metrics || metrics2D(b);
    const keys = [
      ma.unassignedCount - mb.unassignedCount,
      mb.usedArea - ma.usedArea,
      ma.stockArea - mb.stockArea,
      ma.sheetsUsed - mb.sheetsUsed,
    ];
    const stages = ma.stages - mb.stages;
    const cuts = ma.cuts - mb.cuts;
    const rest = mb.largestOffcutArea - ma.largestOffcutArea;
    const usable = mb.usableOffcutArea - ma.usableOffcutArea;
    if (goal === 'simple') keys.push(stages, cuts, rest);
    else if (goal === 'offcuts') keys.push(rest, usable, stages, cuts);
    else keys.push(Math.max(ma.stages, 3) - Math.max(mb.stages, 3), rest, cuts, stages);
    for (const k of keys) {
      if (Number.isNaN(k)) continue;
      if (Math.abs(k) > EPS) return k;
    }
    return 0;
  };

  // Deterministic part orderings (taken over from the former gemini-version.js).
  const SORT_STRATEGIES = {
    area: (a, b) => b.length * b.width - a.length * a.width,
    longestSide: (a, b) => Math.max(b.length, b.width) - Math.max(a.length, a.width),
    perimeter: (a, b) => b.length + b.width - (a.length + a.width),
    length: (a, b) => b.length - a.length || b.width - a.width,
    width: (a, b) => b.width - a.width || b.length - a.length,
    squarenessFirst: (a, b) =>
      Math.max(a.length, a.width) / Math.min(a.length, a.width) -
      Math.max(b.length, b.width) / Math.min(b.length, b.width),
  };

  const PACKERS = ['free', 'rows', 'columns'];

  const evaluate = (parts, stock, options, order, rot, packer = 'free') => {
    const ordered = order.map((i) => parts[i]);
    const prefs = order.map((i) => rot[i]);
    const opts = { ...options, rotationPrefs: prefs };
    const result = packer === 'free' ? pack2D(ordered, stock, opts) : packStrips(ordered, stock, { ...opts, stripDirection: packer });
    result.metrics = metrics2D(result);
    result.packer = packer;
    return result;
  };

  const seedChromosomes = (parts, allowRotation) => {
    const idx = parts.map((_, i) => i);
    const seeds = [];
    Object.values(SORT_STRATEGIES).forEach((cmp) => {
      const order = [...idx].sort((i, j) => cmp(parts[i], parts[j]) || i - j);
      PACKERS.forEach((packer) => {
        seeds.push({ order, rot: parts.map(() => false), packer });
        if (allowRotation) seeds.push({ order: [...order], rot: parts.map(() => true), packer });
      });
    });
    return seeds;
  };

  /** Quick deterministic 2D solution: best of all sort strategies and packers. */
  const solve2D = (stockItems, partItems, options = {}) => {
    const stock = expandItems(stockItems, 'Platte').filter((s) => s.valid);
    const parts = expandItems(partItems, 'Teil');
    let best = null;
    seedChromosomes(parts, !!options.allowRotation).forEach((c) => {
      const r = evaluate(parts, stock, options, c.order, c.rot, c.packer);
      if (!best || compare2D(r, best, options.goal) < 0) best = r;
    });
    if (best) return best;
    const empty = finalize2D({ bins: [], unassigned: [] }, 0, options.minOffcut);
    empty.metrics = metrics2D(empty);
    return empty;
  };

  // Small seeded PRNG so tests are reproducible.
  const mulberry32 = (seed) => {
    let t = seed >>> 0;
    return () => {
      t = (t + 0x6d2b79f5) >>> 0;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  };

  /**
   * Iterative 2D optimizer (genetic algorithm seeded with all heuristics).
   * Call step() repeatedly (e.g. from setTimeout) so the UI stays responsive.
   * The best result is never worse than solve2D().
   */
  const createOptimizer2D = (stockItems, partItems, options = {}, ga = {}) => {
    const {
      populationSize = 24,
      generations = 100,
      eliteSize = 4,
      mutationRate = 0.15,
      stallGenerations = 30,
      random = Math.random,
    } = ga;
    const allowRotation = !!options.allowRotation;
    const stock = expandItems(stockItems, 'Platte').filter((s) => s.valid);
    const parts = expandItems(partItems, 'Teil');
    const n = parts.length;

    const randInt = (k) => Math.floor(random() * k);
    const shuffle = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = randInt(i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };

    const goal = options.goal;
    const cmp = (x, y) => compare2D(x, y, goal);
    let population = seedChromosomes(parts, allowRotation);
    const size = Math.max(populationSize, population.length);
    while (population.length < size) {
      population.push({
        order: shuffle(parts.map((_, i) => i)),
        rot: parts.map(() => allowRotation && random() < 0.5),
        packer: PACKERS[randInt(PACKERS.length)],
      });
    }

    const scored = (pop) =>
      pop
        .map((c) => ({ c, r: evaluate(parts, stock, options, c.order, c.rot, c.packer) }))
        .sort((a, b) => cmp(a.r, b.r));

    // Order crossover (OX) on index permutations; rotation genes follow the part index.
    const crossover = (p1, p2) => {
      if (n < 2) return { order: [...p1.order], rot: [...p1.rot], packer: p1.packer };
      const a = randInt(n);
      const b = a + randInt(n - a);
      const child = new Array(n).fill(-1);
      const taken = new Set();
      for (let i = a; i <= b; i++) {
        child[i] = p1.order[i];
        taken.add(p1.order[i]);
      }
      let k = 0;
      for (let i = 0; i < n; i++) {
        if (child[i] !== -1) continue;
        while (taken.has(p2.order[k])) k++;
        child[i] = p2.order[k];
        taken.add(p2.order[k]);
      }
      const rot = parts.map((_, i) => (random() < 0.5 ? p1.rot[i] : p2.rot[i]));
      return { order: child, rot, packer: random() < 0.5 ? p1.packer : p2.packer };
    };

    const mutate = (c) => {
      const order = [...c.order];
      const rot = [...c.rot];
      if (n > 1 && random() < mutationRate * 3) {
        const i = randInt(n);
        const j = randInt(n);
        [order[i], order[j]] = [order[j], order[i]];
      }
      if (allowRotation) {
        for (let i = 0; i < n; i++) if (random() < mutationRate) rot[i] = !rot[i];
      }
      const packer = random() < mutationRate ? PACKERS[randInt(PACKERS.length)] : c.packer;
      return { order, rot, packer };
    };

    let evaluated = scored(population);
    let best = evaluated[0] ? evaluated[0].r : solve2D(stockItems, partItems, options);
    let generation = 0;
    let sinceImprovement = 0;
    const totalGenerations = n < 2 ? 0 : generations;

    const step = () => {
      if (generation >= totalGenerations || sinceImprovement >= stallGenerations) {
        return { generation, totalGenerations, done: true, improved: false, best, metrics: best.metrics };
      }
      const next = evaluated.slice(0, eliteSize).map((e) => e.c);
      const tournament = () => {
        const x = evaluated[randInt(evaluated.length)];
        const y = evaluated[randInt(evaluated.length)];
        return cmp(x.r, y.r) <= 0 ? x.c : y.c;
      };
      while (next.length < size) next.push(mutate(crossover(tournament(), tournament())));
      population = next;
      evaluated = scored(population);
      generation++;

      let improved = false;
      if (cmp(evaluated[0].r, best) < 0) {
        best = evaluated[0].r;
        improved = true;
        sinceImprovement = 0;
      } else {
        sinceImprovement++;
      }
      const done = generation >= totalGenerations || sinceImprovement >= stallGenerations;
      return { generation, totalGenerations, done, improved, best, metrics: best.metrics };
    };

    return {
      step,
      get best() {
        return best;
      },
      get generation() {
        return generation;
      },
      totalGenerations,
    };
  };

  /** Run the optimizer to completion synchronously (tests / workers). */
  const optimize2D = (stockItems, partItems, options = {}, ga = {}) => {
    const opt = createOptimizer2D(stockItems, partItems, options, ga);
    let s;
    do {
      s = opt.step();
    } while (!s.done);
    return opt.best;
  };

  return {
    REASONS,
    expandItems,
    normalizeQuantity,
    normalizeKerf,
    solve1D,
    metrics1D,
    pack2D,
    packStrips,
    analyzeSheet,
    solve2D,
    metrics2D,
    compare2D,
    GOALS,
    DEFAULT_MIN_OFFCUT,
    createOptimizer2D,
    optimize2D,
    mulberry32,
    SORT_STRATEGIES,
  };
});
