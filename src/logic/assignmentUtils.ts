import {
  AiAssignment,
  CircuitAssignment,
  DesignResult,
  DesignSummary,
  PanelSpec,
  PcsSpec,
  SiteCondition,
  StringDesign,
} from '../types';
import {
  calculateAllowedSeriesRange,
  calculateVocCold,
  checkCurrentConstraints,
} from './stringDesign';

// 禁則: 1〜2枚の直列構成は電圧設計上不適切なため許可しない（3枚以上を必須とする）。
export const MIN_SERIES_MODULES = 3;

function getCircuitsPerMppt(pcs: PcsSpec): number {
  return Math.max(1, Math.ceil(pcs.totalCircuits / Math.max(pcs.mpptCount, 1)));
}

function buildStringDesign(
  panel: PanelSpec,
  minTemperature: number,
  seriesModules: number
): StringDesign | null {
  if (!Number.isInteger(seriesModules) || seriesModules <= 0) {
    return null;
  }

  const vocColdModule = calculateVocCold(panel, minTemperature);

  return {
    seriesModules,
    vmpString: panel.vmp * seriesModules,
    vocStringCold: vocColdModule * seriesModules,
  };
}

export function convertAiAssignmentsToCircuitAssignments(
  panel: PanelSpec,
  pcsList: PcsSpec[],
  condition: SiteCondition,
  aiAssignments: AiAssignment[]
): CircuitAssignment[] {
  const seriesMap = new Map<string, number>();

  aiAssignments.forEach((assignment) => {
    seriesMap.set(
      `${assignment.pcsId}-${assignment.circuitIndex}`,
      assignment.seriesModules
    );
  });

  return pcsList.flatMap((pcs) => {
    const circuitsPerMppt = getCircuitsPerMppt(pcs);

    return Array.from({ length: pcs.totalCircuits }, (_, index) => {
      const circuitIndex = index + 1;
      const seriesModules =
        seriesMap.get(`${pcs.id}-${circuitIndex}`) ?? 0;
      const stringDesign = buildStringDesign(
        panel,
        condition.minTemperature,
        seriesModules
      );

      return {
        pcsId: pcs.id,
        circuitIndex,
        mpptGroupIndex: Math.ceil(circuitIndex / circuitsPerMppt),
        stringDesign,
        currentImp: stringDesign ? panel.imp : 0,
        currentIsc: stringDesign ? panel.isc : 0,
      };
    });
  });
}

type PcsPlanInfo = {
  pcs: PcsSpec;
  nMin: number;
  nMax: number;
  usableCircuits: number; // 電流制約・回路数から使用可能な回路数（MPPTは2回路1組前提）
  reason?: string;        // 使用不可の理由
};

function buildPcsPlanInfo(
  panel: PanelSpec,
  pcsList: PcsSpec[],
  condition: SiteCondition
): PcsPlanInfo[] {
  const vocCold = calculateVocCold(panel, condition.minTemperature);

  return pcsList.map((pcs) => {
    const range = calculateAllowedSeriesRange(panel, pcs, vocCold);

    if (range.error) {
      return { pcs, nMin: 0, nMax: 0, usableCircuits: 0, reason: range.error };
    }
    if (panel.imp > pcs.maxInputCurrentPerCircuit) {
      return { pcs, nMin: 0, nMax: 0, usableCircuits: 0, reason: `${pcs.id}: 回路電流(${panel.imp}A)が上限(${pcs.maxInputCurrentPerCircuit}A)超過` };
    }
    if (panel.isc > pcs.maxIscPerCircuit) {
      return { pcs, nMin: 0, nMax: 0, usableCircuits: 0, reason: `${pcs.id}: 回路短絡電流(${panel.isc}A)が上限(${pcs.maxIscPerCircuit}A)超過` };
    }

    const nMin = Math.max(range.min, MIN_SERIES_MODULES);
    const nMax = range.max;
    if (nMin > nMax) {
      return { pcs, nMin: 0, nMax: 0, usableCircuits: 0, reason: `${pcs.id}: 直列許容範囲が成立しません` };
    }

    // PCS合計短絡電流の制約から使用できる回路数の上限
    const maxCircuitsByIsc = panel.isc > 0 ? Math.floor(pcs.maxIscTotal / panel.isc) : pcs.totalCircuits;
    const usableCircuits = Math.max(0, Math.min(pcs.totalCircuits, maxCircuitsByIsc));

    return { pcs, nMin, nMax, usableCircuits };
  });
}

/**
 * 使用不可のPCSについて、その理由を返す（0枚しか割り付けられない原因の説明用）。
 */
export function diagnoseUnusablePcs(
  panel: PanelSpec,
  pcsList: PcsSpec[],
  condition: SiteCondition
): string[] {
  return buildPcsPlanInfo(panel, pcsList, condition)
    .filter((info) => info.usableCircuits < 1)
    .map((info) => info.reason || `${info.pcs.id}: 使用可能な回路がありません`);
}

/**
 * 1つのPCSに対し、割り当てたいモジュール数(budget)を
 * 「MPPTは2回路1組で直列数を揃える／各回路は[nMin,nMax]／1〜2枚構成なし」という
 * 制約下で回路へ配分する。戻り値は circuitIndex(1始まり) → seriesModules。
 */
function fillPcs(info: PcsPlanInfo, budget: number): Map<number, number> {
  const result = new Map<number, number>();
  const { nMin, nMax, usableCircuits } = info;

  if (usableCircuits < 1 || budget < nMin || nMax < nMin) {
    return result;
  }

  const M = Math.min(budget, usableCircuits * nMax);

  // 使用回路数 c: 各回路が nMin 以上になる範囲でできるだけ多くの回路に分散する
  // （電流を分散し、MPPTを均等に使うため）。
  const c = Math.min(usableCircuits, Math.floor(M / nMin));
  if (c < 1) {
    return result;
  }

  // 基準直列数 base を全 c 回路に置き、端数(extra)をペア単位で +1 して均一に近づける。
  const base = Math.min(Math.max(Math.floor(M / c), nMin), nMax);
  for (let i = 1; i <= c; i += 1) {
    result.set(i, base);
  }

  let extra = M - base * c; // 0 <= extra < c（base==nMax のときは 0）
  const pairs = Math.floor(c / 2);
  const hasSingleton = c % 2 === 1;

  // MPPTペア（連続2回路）に +1 ずつ乗せる（ペアの直列数は必ず揃う）
  let bumpPairs = Math.min(pairs, Math.floor(extra / 2));
  for (let p = 0; p < bumpPairs && base + 1 <= nMax; p += 1) {
    result.set(2 * p + 1, base + 1);
    result.set(2 * p + 2, base + 1);
    extra -= 2;
  }

  // 端数の単独回路が使える場合、残り1枚をそこへ（ペア均等制約は単独回路には非適用）
  if (hasSingleton && extra >= 1 && base + 1 <= nMax) {
    result.set(c, (result.get(c) ?? base) + 1);
    extra -= 1;
  }

  return result;
}

/**
 * 決定的な回路割付を計算する。
 * - 全パネルを可能な限り割り付け（残枚数を最小化）
 * - 過積載率が目標(condition.targetOverloadRatio)付近になるようPCS間を配分
 * - MPPTは2回路1組で直列数を揃える／各回路は許容直列数の範囲内／1〜2枚構成は作らない
 */
export function computeDeterministicAiAssignments(
  panel: PanelSpec,
  pcsList: PcsSpec[],
  condition: SiteCondition
): AiAssignment[] {
  const infos = buildPcsPlanInfo(panel, pcsList, condition);
  const targetRatio = condition.targetOverloadRatio > 0 ? condition.targetOverloadRatio / 100 : 1.45;

  const evenFloor = (x: number) => x - (x % 2);

  // 各PCSの最大収容枚数（ペア単位で扱うため偶数に丸める）と全体の配置可能枚数
  const maxModules = infos.map((info) => info.usableCircuits * info.nMax);
  const evenMax = maxModules.map(evenFloor);
  const totalCapacity = evenMax.reduce((a, b) => a + b, 0);
  const placeableTotal = Math.min(panel.moduleCount, totalCapacity);

  // 初期配分: 目標過積載率での希望枚数を「偶数（ペア単位）」で。各PCS上限でクランプ。
  // 定格容量に比例させることで、全PCSの過積載率が揃う。
  const budgets = infos.map((info, i) => {
    if (info.usableCircuits < 1) return 0;
    const desired = panel.pmax > 0 ? (info.pcs.ratedPower * targetRatio) / panel.pmax : evenMax[i];
    return Math.min(evenFloor(Math.round(desired)), evenMax[i]);
  });

  // placeableTotal に合わせ、ペア単位(±2)で全PCSへ均等(ラウンドロビン)に増減する。
  // 端数を1台に押し付けず、過積載率のばらつきを最小化する。端数(±1)はペアで詰められないため残す。
  const balance = (target: number) => {
    let remaining = target - budgets.reduce((a, b) => a + b, 0);
    // 増やす時は先頭PCSから、減らす時は末尾PCSから回す。
    // これにより「端数(14直列)は後ろのPCSに寄り、前のPCSは満載で揃う」ようになる。
    const order = Array.from({ length: infos.length }, (_, i) => i);
    if (remaining < 0) order.reverse();

    let guard = 0;
    while (Math.abs(remaining) >= 2 && guard < 10000000) {
      guard += 1;
      let moved = false;
      for (const i of order) {
        if (Math.abs(remaining) < 2) break;
        if (infos[i].usableCircuits < 1) continue;
        if (remaining >= 2 && budgets[i] <= evenMax[i] - 2) {
          budgets[i] += 2;
          remaining -= 2;
          moved = true;
        } else if (remaining <= -2 && budgets[i] >= 2) {
          budgets[i] -= 2;
          remaining += 2;
          moved = true;
        }
      }
      if (!moved) break;
    }
  };
  balance(placeableTotal);

  // 各PCSを配分に従って埋める（偶数バジェットは fillPcs が過不足なく実現する）
  const assignments: AiAssignment[] = [];
  let placedTotal = 0;

  infos.forEach((info, i) => {
    const filled = fillPcs(info, budgets[i]);
    for (const [circuitIndex, seriesModules] of filled) {
      assignments.push({ pcsId: info.pcs.id, circuitIndex, seriesModules });
      placedTotal += seriesModules;
    }
  });

  // 端数(1枚)が残る場合のみ、単独回路が使えるPCSへ1枚だけ載せて詰める（決定的）
  let leftover = placeableTotal - placedTotal;
  if (leftover > 0) {
    const byPcs = new Map<string, Map<number, number>>();
    assignments.forEach((a) => {
      if (!byPcs.has(a.pcsId)) byPcs.set(a.pcsId, new Map());
      byPcs.get(a.pcsId)!.set(a.circuitIndex, a.seriesModules);
    });

    let guard = 0;
    while (leftover > 0 && guard < 100000) {
      guard += 1;
      let progressed = false;
      for (const info of infos) {
        if (leftover <= 0) break;
        if (info.usableCircuits < 1) continue;
        const map = byPcs.get(info.pcs.id) ?? new Map<number, number>();

        // 端数の単独回路（奇数番目の未ペア回路）に +1 / nMin で新規起こし
        const lastOdd = info.usableCircuits % 2 === 1 ? info.usableCircuits : 0;
        if (lastOdd) {
          const cur = map.get(lastOdd) ?? 0;
          if (cur > 0 && cur < info.nMax) {
            map.set(lastOdd, cur + 1);
            leftover -= 1;
            progressed = true;
          } else if (cur === 0 && leftover >= info.nMin) {
            map.set(lastOdd, info.nMin);
            leftover -= info.nMin;
            progressed = true;
          }
          byPcs.set(info.pcs.id, map);
        }
      }
      if (!progressed) break;
    }

    assignments.length = 0;
    for (const [pcsId, map] of byPcs) {
      for (const [circuitIndex, seriesModules] of map) {
        if (seriesModules > 0) {
          assignments.push({ pcsId, circuitIndex, seriesModules });
        }
      }
    }
  }

  // circuitIndex 昇順で安定ソート
  assignments.sort((x, y) =>
    x.pcsId === y.pcsId ? x.circuitIndex - y.circuitIndex : x.pcsId < y.pcsId ? -1 : 1
  );

  return assignments;
}

export function summarizeAssignments(
  panel: PanelSpec,
  pcsList: PcsSpec[],
  condition: SiteCondition,
  assignments: CircuitAssignment[]
): DesignResult {
  const summaries: DesignSummary[] = [];
  const globalWarnings: string[] = [];
  let totalPvCapacityW = 0;
  let totalPcsCapacityW = 0;
  let totalModulesAssigned = 0;

  pcsList.forEach((pcs) => {
    totalPcsCapacityW += pcs.ratedPower;

    const pcsAssignments = assignments.filter((assignment) => assignment.pcsId === pcs.id);
    const pcsWarnings: string[] = [];
    const range = calculateAllowedSeriesRange(
      panel,
      pcs,
      calculateVocCold(panel, condition.minTemperature)
    );

    if (range.error) {
      pcsWarnings.push(range.error);
    }

    let pcsModules = 0;
    let usedCircuits = 0;

    pcsAssignments.forEach((assignment) => {
      const seriesModules = assignment.stringDesign?.seriesModules ?? 0;
      if (seriesModules <= 0) {
        return;
      }

      usedCircuits += 1;
      pcsModules += seriesModules;

      if (!range.error && (seriesModules < range.min || seriesModules > range.max)) {
        pcsWarnings.push(
          `警告: ${pcs.id} 回路${assignment.circuitIndex} の直列数(${seriesModules})が許容範囲(${range.min}〜${range.max})外です`
        );
      }
    });

    if (usedCircuits > 0) {
      pcsWarnings.push(
        ...checkCurrentConstraints(
          panel,
          pcs,
          pcsAssignments.find((assignment) => assignment.stringDesign)?.stringDesign as StringDesign
        )
      );
    }

    const totalIsc = usedCircuits * panel.isc;
    if (totalIsc > pcs.maxIscTotal) {
      pcsWarnings.push(
        `警告: PCS合計短絡電流(${totalIsc.toFixed(1)}A)が最大値(${pcs.maxIscTotal}A)を超過`
      );
    }

    const pcsPvPower = pcsModules * panel.pmax;
    const overloadRatio = pcs.ratedPower > 0 ? (pcsPvPower / pcs.ratedPower) * 100 : 0;
    if (overloadRatio < condition.targetOverloadRatio * 0.8 && pcs.ratedPower > 0) {
      pcsWarnings.push(
        `情報: 過積載率(${overloadRatio.toFixed(1)}%)が目標(${condition.targetOverloadRatio}%)より大幅に低いです`
      );
    }

    totalModulesAssigned += pcsModules;
    totalPvCapacityW += pcsPvPower;

    summaries.push({
      pcsId: pcs.id,
      totalModulesAssigned: pcsModules,
      usedCircuits,
      overloadRatio,
      warnings: Array.from(new Set(pcsWarnings)),
      pvCapacityKw: pcsPvPower / 1000,
      pcsCapacityKw: pcs.ratedPower / 1000,
    });
  });

  const remainingModules = panel.moduleCount - totalModulesAssigned;
  if (remainingModules > 0) {
    globalWarnings.push(
      `注意: ${remainingModules} 枚のパネルが配置されずに残っています。PCSを追加するか構成を見直してください。`
    );
  } else if (remainingModules < 0) {
    globalWarnings.push(
      `警告: パネル総数(${panel.moduleCount}枚)に対し、${Math.abs(remainingModules)} 枚多く割り当てられています。`
    );
  }

  return {
    assignments,
    summaries,
    totalOverloadRatio:
      totalPcsCapacityW > 0 ? (totalPvCapacityW / totalPcsCapacityW) * 100 : 0,
    totalPvCapacityKw: totalPvCapacityW / 1000,
    totalPcsCapacityKw: totalPcsCapacityW / 1000,
    globalWarnings,
  };
}

export function validateAiAssignments(
  panel: PanelSpec,
  pcsList: PcsSpec[],
  condition: SiteCondition,
  aiAssignments: AiAssignment[]
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const slots = new Map<string, PcsSpec>();

  pcsList.forEach((pcs) => {
    for (let circuitIndex = 1; circuitIndex <= pcs.totalCircuits; circuitIndex += 1) {
      slots.set(`${pcs.id}-${circuitIndex}`, pcs);
    }
  });

  let assignedModules = 0;
  const usedCircuitCountByPcs = new Map<string, number>();

  aiAssignments.forEach((assignment) => {
    const slotKey = `${assignment.pcsId}-${assignment.circuitIndex}`;
    const pcs = slots.get(slotKey);

    if (!pcs) {
      errors.push(`不正な回路指定です: ${slotKey}`);
      return;
    }

    if (seen.has(slotKey)) {
      errors.push(`同一回路が重複しています: ${slotKey}`);
      return;
    }

    seen.add(slotKey);

    if (!Number.isInteger(assignment.seriesModules) || assignment.seriesModules < 0) {
      errors.push(`直列数は0以上の整数で指定してください: ${slotKey}`);
      return;
    }

    if (assignment.seriesModules === 0) {
      return;
    }

    if (assignment.seriesModules < MIN_SERIES_MODULES) {
      errors.push(
        `${slotKey} の直列数(${assignment.seriesModules})が少なすぎます。1〜2枚構成は禁止です（${MIN_SERIES_MODULES}枚以上、かつ許容範囲内にしてください）。`
      );
      return;
    }

    assignedModules += assignment.seriesModules;

    const range = calculateAllowedSeriesRange(
      panel,
      pcs,
      calculateVocCold(panel, condition.minTemperature)
    );

    if (range.error) {
      errors.push(`${pcs.id} は設計不可能です: ${range.error}`);
      return;
    }

    if (assignment.seriesModules < range.min || assignment.seriesModules > range.max) {
      errors.push(
        `${slotKey} の直列数(${assignment.seriesModules})が許容範囲(${range.min}〜${range.max})外です`
      );
    }

    if (panel.imp > pcs.maxInputCurrentPerCircuit) {
      errors.push(`${pcs.id} の最大回路電流制限を超過しています`);
    }

    if (panel.isc > pcs.maxIscPerCircuit) {
      errors.push(`${pcs.id} の最大回路短絡電流制限を超過しています`);
    }

    usedCircuitCountByPcs.set(
      pcs.id,
      (usedCircuitCountByPcs.get(pcs.id) ?? 0) + 1
    );
  });

  if (assignedModules > panel.moduleCount) {
    errors.push(
      `割付枚数(${assignedModules})がパネル総数(${panel.moduleCount})を超過しています`
    );
  }

  pcsList.forEach((pcs) => {
    const usedCircuitCount = usedCircuitCountByPcs.get(pcs.id) ?? 0;
    const totalIsc = usedCircuitCount * panel.isc;
    if (totalIsc > pcs.maxIscTotal) {
      errors.push(
        `${pcs.id} のPCS合計短絡電流(${totalIsc.toFixed(1)}A)が最大値(${pcs.maxIscTotal}A)を超過しています`
      );
    }
  });

  return Array.from(new Set(errors));
}
