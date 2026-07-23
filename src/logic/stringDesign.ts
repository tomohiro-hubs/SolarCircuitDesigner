import { PanelSpec, PcsSpec, SiteCondition, StringDesign, CircuitAssignment, DesignSummary, DesignResult } from '../types';

/**
 * 1. 温度補正 Voc (最低温度時の開放電圧) を計算
 */
export function calculateVocCold(panel: PanelSpec, minTemp: number): number {
  const tempCoeffVocFraction = panel.tempCoeffVoc / 100;
  const deltaT = minTemp - 25; // STC 25°C
  const vocColdModule = panel.voc * (1 + tempCoeffVocFraction * deltaT);
  return vocColdModule;
}

/**
 * 2-4. 直列枚数 N の許容範囲を計算
 */
export function calculateAllowedSeriesRange(
  panel: PanelSpec,
  pcs: PcsSpec,
  vocColdModule: number
): { min: number; max: number; error?: string } {
  // MPPT 範囲による制限
  const nMinByMppt = Math.ceil(pcs.mpptMinVoltage / panel.vmp);
  const nMaxByMppt = Math.floor(pcs.mpptMaxVoltage / panel.vmp);

  // 最大入力電圧による制限
  const nMaxByVoc = Math.floor(pcs.maxInputVoltage / vocColdModule);

  const nMin = nMinByMppt;
  const nMax = Math.min(nMaxByMppt, nMaxByVoc);

  if (nMin > nMax) {
    return { min: 0, max: 0, error: `設計不可能: MPPT範囲と最大電圧制約を満たす直列数が存在しません (Min:${nMin}, MaxByMppt:${nMaxByMppt}, MaxByVoc:${nMaxByVoc})` };
  }

  return { min: nMin, max: nMax };
}

/**
 * 5. 推奨直列枚数を選択
 * ヒューリスティック: N_max に近い値を優先しつつ、回路分割時の余りを考慮
 */
export function selectBestSeriesCount(
  range: { min: number; max: number },
  _panel: PanelSpec,
  _allPcs: PcsSpec[]
): number {
  // シンプル版: 最大枚数を採用 (電圧高めの方が効率が良い傾向があるため)
  // TODO: 全体の枚数配分を考慮した最適化
  return range.max;
}

/**
 * 7. 電流制約のチェック
 */
export function checkCurrentConstraints(
  panel: PanelSpec,
  pcs: PcsSpec,
  _stringDesign: StringDesign
): string[] {
  const warnings: string[] = [];
  
  // 並列なし前提: 回路電流 = Imp
  if (panel.imp > pcs.maxInputCurrentPerCircuit) {
    warnings.push(`警告: パネルImp(${panel.imp}A)がPCS回路最大電流(${pcs.maxInputCurrentPerCircuit}A)を超過`);
  }
  
  if (panel.isc > pcs.maxIscPerCircuit) {
    warnings.push(`警告: パネルIsc(${panel.isc}A)がPCS回路最大短絡電流(${pcs.maxIscPerCircuit}A)を超過`);
  }

  return warnings;
}

/**
 * 全体の設計計算実行
 */
export function calculateDesign(
  panel: PanelSpec,
  pcsList: PcsSpec[],
  condition: SiteCondition
): DesignResult {
  // 1. Voc Cold 計算
  const vocColdModule = calculateVocCold(panel, condition.minTemperature);
  
  // 2. 推奨直列数決定 (全PCSで共通のNとする簡易ロジック)
  // 複数のPCSがある場合、最も制約が厳しいものを基準にするか、あるいは最初のPCSを基準にする
  // ここでは最初のPCSの制約をベースにする (通常、同一型式のPCSを使うことが多いため)
  if (pcsList.length === 0) {
    return createEmptyResult();
  }

  const representativePcs = pcsList[0];
  const range = calculateAllowedSeriesRange(panel, representativePcs, vocColdModule);
  
  const globalWarnings: string[] = [];
  if (range.error) {
    globalWarnings.push(range.error);
  }

  // 直列数決定: 手動指定があればそれを優先チェック
  let seriesCount = 0;

  if (condition.manualSeriesCount && condition.manualSeriesCount > 0) {
    const manualN = condition.manualSeriesCount;
    seriesCount = manualN;
    
    // マニュアル指定時の妥当性チェック
    if (manualN < range.min || manualN > range.max) {
        globalWarnings.push(`警告: 指定された直列数(${manualN})は推奨範囲(${range.min}〜${range.max}枚)外です。電圧制約に違反する可能性があります。`);
    }
  } else {
    // 自動計算
    seriesCount = range.max > 0 ? selectBestSeriesCount(range, panel, pcsList) : 0;
  }

  const stringDesign: StringDesign = {
    seriesModules: seriesCount,
    vmpString: panel.vmp * seriesCount,
    vocStringCold: vocColdModule * seriesCount
  };

  // 2.5. 手動指定PCSの回路構成を先に確定する
  type ManualInfo = { usedCircuits: number; stringDesign: StringDesign; seriesModules: number };
  const manualInfoMap = new Map<string, ManualInfo>();
  let totalManualModules = 0;

  for (const pcs of pcsList) {
    if (pcs.manualCircuitEnabled && pcs.manualSeriesModules && pcs.manualSeriesModules > 0) {
      const rawParallel = pcs.manualParallelCount;
      const requestedCircuits = Number.isFinite(rawParallel) && rawParallel ? rawParallel : 0;
      const usedCircuits = Math.max(0, Math.min(requestedCircuits, pcs.totalCircuits));
      const manualStringDesign: StringDesign = {
        seriesModules: pcs.manualSeriesModules,
        vmpString: panel.vmp * pcs.manualSeriesModules,
        vocStringCold: vocColdModule * pcs.manualSeriesModules
      };
      manualInfoMap.set(pcs.id, { usedCircuits, stringDesign: manualStringDesign, seriesModules: pcs.manualSeriesModules });
      totalManualModules += pcs.manualSeriesModules * usedCircuits;
    }
  }

  // 3. パネル割り当て計算 (手動指定PCSを先に消費し、残りをラウンドロビンで自動PCSに配分)
  const assignments: CircuitAssignment[] = [];
  const summaries: DesignSummary[] = [];

  let totalPvCapacityW = 0;
  const totalPcsCapacityW = pcsList.reduce((sum, pcs) => sum + pcs.ratedPower, 0);

  let modulePool = panel.moduleCount - totalManualModules;
  if (modulePool < 0) {
    globalWarnings.push(`警告: 手動指定を含む割当枚数がパネル総数(${panel.moduleCount}枚)を超えています。`);
    modulePool = 0;
  }

  // 有効なストリング数を計算 (自動割り当て分)
  const totalStrings = seriesCount > 0 ? Math.floor(modulePool / seriesCount) : 0;
  let remainingModules = modulePool - totalStrings * seriesCount; // 端数は割り当てずに残る

  // 自動割り当て対象のPCS (手動指定PCSを除く)
  const autoPcsList = pcsList.filter((pcs) => !manualInfoMap.has(pcs.id));

  // スロットへの割り当て状況を管理するマップ (自動割り当て分のみ)
  // key: `${pcsId}-${circuitIndex}`
  const assignedMap = new Map<string, boolean>();

  // 各PCSの次の空き回路インデックス管理
  const nextCircuitIndex = new Map<string, number>(autoPcsList.map((pcs) => [pcs.id, 1]));

  let stringsToAssign = totalStrings;

  while (stringsToAssign > 0) {
    let assignedInThisRound = false;

    for (const pcs of autoPcsList) {
        if (stringsToAssign <= 0) break;

        const circuitIdx = nextCircuitIndex.get(pcs.id) ?? 1;

        if (circuitIdx <= pcs.totalCircuits) {
            // 割り当て実行
            assignedMap.set(`${pcs.id}-${circuitIdx}`, true);
            nextCircuitIndex.set(pcs.id, circuitIdx + 1); // 次の回路へ進める
            stringsToAssign--;
            assignedInThisRound = true;
        }
    }

    // 全PCSが満杯ならループ終了
    if (!assignedInThisRound) break;
  }

  // 割り当てられなかったストリングがあれば残材に戻す
  if (stringsToAssign > 0) {
      remainingModules += stringsToAssign * seriesCount;
  }

  // 結果オブジェクトの構築
  for (const pcs of pcsList) {
    let modulesAssignedToPcs = 0;
    let usedCircuits = 0;
    const manualInfo = manualInfoMap.get(pcs.id);
    const pcsWarnings: string[] = [...checkCurrentConstraints(panel, pcs, manualInfo ? manualInfo.stringDesign : stringDesign)];

    const circuitsPerMppt = Math.floor(pcs.totalCircuits / pcs.mpptCount);

    for (let i = 1; i <= pcs.totalCircuits; i++) {
      const mpptGroupIndex = Math.ceil(i / circuitsPerMppt);

      let assignedString: StringDesign | null = null;

      if (manualInfo) {
        if (i <= manualInfo.usedCircuits) {
          assignedString = { ...manualInfo.stringDesign };
          modulesAssignedToPcs += manualInfo.seriesModules;
          usedCircuits++;
        }
      } else {
        const isAssigned = assignedMap.get(`${pcs.id}-${i}`);
        if (isAssigned) {
          assignedString = { ...stringDesign };
          modulesAssignedToPcs += seriesCount;
          usedCircuits++;
        }
      }

      assignments.push({
        pcsId: pcs.id,
        circuitIndex: i,
        mpptGroupIndex: mpptGroupIndex,
        stringDesign: assignedString,
        currentImp: assignedString ? panel.imp : 0,
        currentIsc: assignedString ? panel.isc : 0
      });
    }

    // PCS単位の集計
    const pcsPvPower = modulesAssignedToPcs * panel.pmax;
    totalPvCapacityW += pcsPvPower;
    const overloadRatio = pcs.ratedPower > 0 ? (pcsPvPower / pcs.ratedPower) * 100 : 0;

    // Isc Total Check
    const totalIsc = usedCircuits * panel.isc; // 並列なし前提
    if (totalIsc > pcs.maxIscTotal) {
      pcsWarnings.push(`警告: PCS合計短絡電流(${totalIsc.toFixed(1)}A)が最大値(${pcs.maxIscTotal}A)を超過`);
    }

    if (overloadRatio < condition.targetOverloadRatio * 0.8 && pcs.ratedPower > 0) {
        pcsWarnings.push(`情報: 過積載率(${overloadRatio.toFixed(1)}%)が目標(${condition.targetOverloadRatio}%)より大幅に低いです`);
    }

    // 手動指定PCSの直列数が推奨範囲内かチェック
    if (manualInfo) {
      const manualRange = calculateAllowedSeriesRange(panel, pcs, vocColdModule);
      if (manualInfo.seriesModules < manualRange.min || manualInfo.seriesModules > manualRange.max) {
        pcsWarnings.push(`警告: ${pcs.id} の手動直列数(${manualInfo.seriesModules})が推奨範囲(${manualRange.min}〜${manualRange.max}枚)外です`);
      }
    }

    summaries.push({
      pcsId: pcs.id,
      totalModulesAssigned: modulesAssignedToPcs,
      usedCircuits,
      overloadRatio,
      warnings: pcsWarnings,
      pvCapacityKw: pcsPvPower / 1000,
      pcsCapacityKw: pcs.ratedPower / 1000
    });
  }

  if (remainingModules > 0) {
    globalWarnings.push(`注意: ${remainingModules} 枚のパネルが配置されずに残っています。PCSを追加するか構成を見直してください。`);
  }

  const totalOverloadRatio = totalPcsCapacityW > 0 ? (totalPvCapacityW / totalPcsCapacityW) * 100 : 0;

  return {
    assignments,
    summaries,
    totalOverloadRatio,
    totalPvCapacityKw: totalPvCapacityW / 1000,
    totalPcsCapacityKw: totalPcsCapacityW / 1000,
    globalWarnings
  };
}

function createEmptyResult(): DesignResult {
  return {
    assignments: [],
    summaries: [],
    totalOverloadRatio: 0,
    totalPvCapacityKw: 0,
    totalPcsCapacityKw: 0,
    globalWarnings: []
  };
}
