import * as XLSX from 'xlsx';
import { PanelPreset, PanelSpec, PcsPreset, PcsSpec, SiteCondition } from '../types';

type ImportedSettings = {
  panel: PanelSpec;
  pcsList: PcsSpec[];
  condition: SiteCondition;
  warnings: string[];
};

function parseLabeledNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getRowMap(rows: unknown[][]): Map<string, unknown[]> {
  return new Map(
    rows
      .filter((row) => Array.isArray(row) && row.length > 0 && typeof row[0] === 'string')
      .map((row) => [String(row[0]).trim(), row])
  );
}

function parseTotalCircuits(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const match = value.match(/\/\s*(\d+)/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePcsFromPreset(
  preset: PcsPreset,
  pcsId: string,
  ratedPower: number | null,
  totalCircuits: number | null
): PcsSpec {
  return {
    id: pcsId,
    ...preset,
    ratedPower: ratedPower ?? preset.ratedPower,
    totalCircuits: totalCircuits ?? preset.totalCircuits,
  };
}

export async function importSettingsFromExcel(
  file: File,
  panelPresets: PanelPreset[],
  pcsPresets: PcsPreset[]
): Promise<ImportedSettings> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const summarySheet = workbook.Sheets['設計サマリー'];

  if (!summarySheet) {
    throw new Error('「設計サマリー」シートが見つかりません。旧Excel出力ファイルを指定してください。');
  }

  const rows = XLSX.utils.sheet_to_json(summarySheet, {
    header: 1,
    raw: false,
    blankrows: false,
  }) as unknown[][];

  const rowMap = getRowMap(rows);
  const panelPresetMap = new Map<string, PanelPreset>();
  const pcsPresetMap = new Map<string, PcsPreset>();
  panelPresets.forEach((preset) => {
    panelPresetMap.set(preset.model, preset);
  });
  pcsPresets.forEach((preset) => {
    pcsPresetMap.set(preset.model, preset);
  });

  const manufacturer = toStringValue(rowMap.get('メーカー')?.[1]);
  const model = toStringValue(rowMap.get('型式')?.[1]);
  const pmax = parseLabeledNumber(rowMap.get('最大出力 (Pmax)')?.[1]);
  const voc = parseLabeledNumber(rowMap.get('開放電圧 (Voc)')?.[1]);
  const vmp = parseLabeledNumber(rowMap.get('動作電圧 (Vmp)')?.[1]);
  const isc = parseLabeledNumber(rowMap.get('短絡電流 (Isc)')?.[1]);
  const imp = parseLabeledNumber(rowMap.get('動作電流 (Imp)')?.[1]);
  const tempCoeffVoc = parseLabeledNumber(rowMap.get('温度係数(Voc)')?.[1]);
  const moduleCount = parseLabeledNumber(rowMap.get('パネル総数')?.[1]);
  const minTemperature = parseLabeledNumber(rowMap.get('想定最低気温')?.[1]);
  const targetOverloadRatio = parseLabeledNumber(rowMap.get('目標過積載率')?.[1]);

  if (!manufacturer || !model || pmax === null || voc === null || vmp === null || isc === null || imp === null || tempCoeffVoc === null || moduleCount === null || minTemperature === null || targetOverloadRatio === null) {
    throw new Error('Excelから必要なパネル/設置条件の値を読み取れませんでした。');
  }

  const panel: PanelSpec = {
    manufacturer,
    model,
    pmax,
    voc,
    vmp,
    isc,
    imp,
    tempCoeffVoc,
    tempCoeffIsc: panelPresetMap.get(model)?.tempCoeffIsc ?? 0.04,
    moduleCount,
  };

  const condition: SiteCondition = {
    minTemperature,
    targetOverloadRatio,
    manualSeriesCount: 0,
  };

  const headerIndex = rows.findIndex(
    (row) =>
      Array.isArray(row) &&
      row[0] === 'PCS ID' &&
      row[1] === '型式'
  );

  if (headerIndex < 0) {
    throw new Error('PCS別サマリー行が見つかりません。');
  }

  const warnings: string[] = [];
  const pcsList: PcsSpec[] = [];

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (!Array.isArray(row) || row.length === 0) {
      if (pcsList.length > 0) {
        break;
      }
      continue;
    }

    const pcsId = toStringValue(row[0]);
    const pcsModel = toStringValue(row[1]);
    if (!pcsId || !pcsModel) {
      break;
    }

    const preset = pcsPresetMap.get(pcsModel);
    if (!preset) {
      warnings.push(`PCS「${pcsModel}」は既定/保存済み項目に無いため復元できませんでした。`);
      continue;
    }

    const ratedPowerKw = parseLabeledNumber(row[2]);
    const totalCircuits = parseTotalCircuits(row[5]);
    const ratedPower = ratedPowerKw === null ? null : ratedPowerKw * 1000;

    pcsList.push(normalizePcsFromPreset(preset, pcsId, ratedPower, totalCircuits));
  }

  if (pcsList.length === 0) {
    throw new Error('復元可能なPCSが1件も見つかりませんでした。PCS型式の保存済み項目を確認してください。');
  }

  return {
    panel,
    pcsList,
    condition,
    warnings,
  };
}
