import * as XLSX from 'xlsx';
import { DesignResult, PanelSpec, PcsSpec, SiteCondition } from '../types';

/**
 * 設計結果を2シート構成（設計サマリー / 回路割付詳細）のExcelとしてダウンロードする。
 * 旧・単一ファイル版 index.html の exportToExcel を React 版へ移植したもの。
 */
export function exportDesignToExcel(
  result: DesignResult,
  panel: PanelSpec,
  pcsList: PcsSpec[],
  condition: SiteCondition,
  projectName: string
): void {
  const wb = XLSX.utils.book_new();
  const now = new Date().toLocaleString();

  // --- Sheet 1: 設計サマリー ---
  const totalAssigned = result.summaries.reduce((acc, s) => acc + s.totalModulesAssigned, 0);
  const summaryRows: (string | number)[][] = [
    ['Solar Circuit Designer - 設計シミュレーション結果報告書'],
    ['発電所名', projectName || '未設定'],
    ['出力日時', now],
    [],
    ['【1. 設置条件】'],
    ['想定最低気温', `${condition.minTemperature} ℃`],
    ['目標過積載率', `${condition.targetOverloadRatio} %`],
    [],
    ['【2. パネル仕様】'],
    ['メーカー', panel.manufacturer],
    ['型式', panel.model],
    ['最大出力 (Pmax)', `${panel.pmax} W`],
    ['開放電圧 (Voc)', `${panel.voc} V`],
    ['動作電圧 (Vmp)', `${panel.vmp} V`],
    ['短絡電流 (Isc)', `${panel.isc} A`],
    ['動作電流 (Imp)', `${panel.imp} A`],
    ['温度係数(Voc)', `${panel.tempCoeffVoc} %/℃`],
    ['パネル総数', `${panel.moduleCount} 枚`],
    [],
    ['【3. 全体設計結果】'],
    ['PVシステム総容量', `${result.totalPvCapacityKw.toFixed(2)} kW`],
    ['PCS定格総出力', `${result.totalPcsCapacityKw.toFixed(2)} kW`],
    ['全体過積載率', `${result.totalOverloadRatio.toFixed(1)} %`],
    ['未配置パネル数', `${panel.moduleCount - totalAssigned} 枚`],
    [],
    ['【4. PCS別サマリー】'],
    ['PCS ID', '型式', '定格出力(kW)', 'PV入力(kW)', '過積載率(%)', '使用回路数', '入力枚数', '判定'],
  ];

  result.summaries.forEach((s) => {
    const pcs = pcsList.find((p) => p.id === s.pcsId);
    const status = s.warnings.length > 0 ? `要確認: ${s.warnings.join(', ')}` : 'OK';
    summaryRows.push([
      s.pcsId,
      pcs ? pcs.model : '-',
      s.pcsCapacityKw.toFixed(2),
      s.pvCapacityKw.toFixed(2),
      s.overloadRatio.toFixed(1),
      `${s.usedCircuits} / ${pcs ? pcs.totalCircuits : '-'}`,
      s.totalModulesAssigned,
      status,
    ]);
  });

  if (result.globalWarnings.length > 0) {
    summaryRows.push([], ['【全体警告・注意事項】']);
    result.globalWarnings.forEach((w) => summaryRows.push([w]));
  }

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = [
    { wch: 25 }, { wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 50 },
  ];
  XLSX.utils.book_append_sheet(wb, wsSummary, '設計サマリー');

  // --- Sheet 2: 回路割付詳細 ---
  const detailHeader = [
    'PCS ID', '回路No', 'MPPTグループ', '直列数(枚)',
    'ストリングVmp(V)', 'ストリングVoc低温(V)',
    'パネルImp(A)', 'パネルIsc(A)',
    '判定/警告',
  ];
  const detailRows: (string | number)[][] = [detailHeader];

  const sortedAssignments = [...result.assignments].sort((a, b) => {
    if (a.pcsId !== b.pcsId) return a.pcsId.localeCompare(b.pcsId);
    return a.circuitIndex - b.circuitIndex;
  });

  sortedAssignments.forEach((a) => {
    const pcs = pcsList.find((p) => p.id === a.pcsId);
    const n = a.stringDesign?.seriesModules ?? 0;

    if (n > 0 && a.stringDesign) {
      const vmp = a.stringDesign.vmpString;
      const voc = a.stringDesign.vocStringCold;
      const warnings: string[] = [];
      if (pcs) {
        if (vmp < pcs.mpptMinVoltage) warnings.push(`Vmp下限割れ(${vmp.toFixed(1)}V)`);
        if (vmp > pcs.mpptMaxVoltage) warnings.push(`Vmp上限超過(${vmp.toFixed(1)}V)`);
        if (voc > pcs.maxInputVoltage) warnings.push(`最大入力超過(${voc.toFixed(1)}V)`);
      }
      const status = warnings.length > 0 ? `NG: ${warnings.join(', ')}` : 'OK';
      detailRows.push([
        a.pcsId, a.circuitIndex, a.mpptGroupIndex, n,
        vmp.toFixed(1), voc.toFixed(1), panel.imp, panel.isc, status,
      ]);
    } else {
      detailRows.push([
        a.pcsId, a.circuitIndex, a.mpptGroupIndex, '-', '-', '-', '-', '-', '未使用',
      ]);
    }
  });

  const wsDetail = XLSX.utils.aoa_to_sheet(detailRows);
  wsDetail['!cols'] = [
    { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 12 },
    { wch: 15 }, { wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 40 },
  ];
  XLSX.utils.book_append_sheet(wb, wsDetail, '回路割付詳細');

  const filename = `SolarDesign_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, filename);
}
