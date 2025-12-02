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
  panel: PanelSpec,
  allPcs: PcsSpec[]
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
  stringDesign: StringDesign
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

  // 3. パネル割り当て計算 (ラウンドロビン方式: PCS間均等化)
  let remainingModules = panel.moduleCount;
  const assignments: CircuitAssignment[] = [];
  const summaries: DesignSummary[] = [];

  let totalPvCapacityW = 0;
  let totalPcsCapacityW = 0;
  
  // 有効なストリング数を計算
  const totalStrings = seriesCount > 0 ? Math.floor(panel.moduleCount / seriesCount) : 0;
  remainingModules -= totalStrings * seriesCount; // 端数は割り当てずに残る

  // 全PCSの全回路スロットをリストアップ (割り当て計画用)
  type Slot = { pcsIndex: number; pcsId: string; circuitIndex: number; mpptGroupIndex: number; };
  const allSlots: Slot[] = [];

  pcsList.forEach((pcs, pcsIndex) => {
    totalPcsCapacityW += pcs.ratedPower;
    const circuitsPerMppt = Math.floor(pcs.totalCircuits / pcs.mpptCount);
    for (let i = 1; i <= pcs.totalCircuits; i++) {
        allSlots.push({
            pcsIndex,
            pcsId: pcs.id,
            circuitIndex: i,
            mpptGroupIndex: Math.ceil(i / circuitsPerMppt)
        });
    }
  });

  // スロットへの割り当て状況を管理するマップ
  // key: `${pcsId}-${circuitIndex}`
  const assignedMap = new Map<string, boolean>();

  // 割り当てロジック: PCSごとに均等に配る (Round-Robin)
  // スロットリストを、PCS順に並べ替えるのではなく、
  // PCS1-回路1, PCS2-回路1, PCS3-回路1, ... PCS1-回路2, PCS2-回路2... の順で配るのが理想的だが、
  // シンプルに「PCS1, PCS2...」の順で1つずつ配るループを回す。
  
  // 各PCSの次の空き回路インデックス管理
  const nextCircuitIndex = pcsList.map(() => 1); 

  let stringsToAssign = totalStrings;
  
  while (stringsToAssign > 0) {
    let assignedInThisRound = false;
    
    for (let i = 0; i < pcsList.length; i++) {
        if (stringsToAssign <= 0) break;

        const pcs = pcsList[i];
        const circuitIdx = nextCircuitIndex[i];

        if (circuitIdx <= pcs.totalCircuits) {
            // 割り当て実行
            assignedMap.set(`${pcs.id}-${circuitIdx}`, true);
            nextCircuitIndex[i]++; // 次の回路へ進める
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
    const pcsAssignments: CircuitAssignment[] = [];
    let modulesAssignedToPcs = 0;
    let usedCircuits = 0;
    const pcsWarnings: string[] = [...checkCurrentConstraints(panel, pcs, stringDesign)];

    const circuitsPerMppt = Math.floor(pcs.totalCircuits / pcs.mpptCount);

    for (let i = 1; i <= pcs.totalCircuits; i++) {
      const mpptGroupIndex = Math.ceil(i / circuitsPerMppt);
      const isAssigned = assignedMap.get(`${pcs.id}-${i}`);
      
      let assignedString: StringDesign | null = null;

      if (isAssigned) {
        assignedString = { ...stringDesign };
        modulesAssignedToPcs += seriesCount;
        usedCircuits++;
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
