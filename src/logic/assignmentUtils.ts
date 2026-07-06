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
