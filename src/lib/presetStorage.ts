import { CustomPresetBundle, PanelPreset, PcsPreset } from '../types';

const PANEL_STORAGE_KEY = 'customPanelPresets';
const PCS_STORAGE_KEY = 'customPcsPresets';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toOptionalFiniteNumber(value: unknown): number | undefined {
  if (value === '' || value === null || value === undefined) {
    return undefined;
  }

  return toFiniteNumber(value) ?? undefined;
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function normalizePanelPreset(value: unknown): PanelPreset | null {
  if (!isRecord(value)) {
    return null;
  }

  const manufacturer = toNonEmptyString(value.manufacturer);
  const model = toNonEmptyString(value.model);
  const voc = toFiniteNumber(value.voc);
  const vmp = toFiniteNumber(value.vmp);
  const isc = toFiniteNumber(value.isc);
  const imp = toFiniteNumber(value.imp);
  const pmax = toFiniteNumber(value.pmax);
  const tempCoeffVoc = toFiniteNumber(value.tempCoeffVoc);
  const tempCoeffIsc = toFiniteNumber(value.tempCoeffIsc);

  if (!manufacturer || !model || voc === null || vmp === null || isc === null || imp === null || pmax === null || tempCoeffVoc === null || tempCoeffIsc === null) {
    return null;
  }

  return {
    manufacturer,
    model,
    voc,
    vmp,
    isc,
    imp,
    pmax,
    tempCoeffVoc,
    tempCoeffIsc,
  };
}

export function normalizePcsPreset(value: unknown): PcsPreset | null {
  if (!isRecord(value)) {
    return null;
  }

  const manufacturer = toNonEmptyString(value.manufacturer);
  const model = toNonEmptyString(value.model);
  const ratedPower = toFiniteNumber(value.ratedPower);
  const totalCircuits = toFiniteNumber(value.totalCircuits);
  const mpptCount = toFiniteNumber(value.mpptCount);
  const startupVoltage = toFiniteNumber(value.startupVoltage);
  const mpptMinVoltage = toFiniteNumber(value.mpptMinVoltage);
  const mpptMaxVoltage = toFiniteNumber(value.mpptMaxVoltage);
  const maxInputVoltage = toFiniteNumber(value.maxInputVoltage);
  const maxInputCurrentPerCircuit = toFiniteNumber(value.maxInputCurrentPerCircuit);
  const maxIscPerCircuit = toFiniteNumber(value.maxIscPerCircuit);
  const maxIscTotal = toFiniteNumber(value.maxIscTotal);
  const efficiency = toFiniteNumber(value.efficiency);

  if (
    !manufacturer ||
    !model ||
    ratedPower === null ||
    totalCircuits === null ||
    mpptCount === null ||
    startupVoltage === null ||
    mpptMinVoltage === null ||
    mpptMaxVoltage === null ||
    maxInputVoltage === null ||
    maxInputCurrentPerCircuit === null ||
    maxIscPerCircuit === null ||
    maxIscTotal === null ||
    efficiency === null
  ) {
    return null;
  }

  return {
    manufacturer,
    model,
    ratedPower,
    totalCircuits,
    mpptCount,
    ratedInputVoltage: toOptionalFiniteNumber(value.ratedInputVoltage),
    startupVoltage,
    mpptMinVoltage,
    mpptMaxVoltage,
    maxInputVoltage,
    maxInputCurrentPerCircuit,
    maxIscPerCircuit,
    maxIscTotal,
    efficiency,
  };
}

function loadCustomList<T>(storageKey: string, normalizer: (value: unknown) => T | null): T[] {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map(normalizer).filter((item): item is T => item !== null);
  } catch {
    return [];
  }
}

function saveCustomList<T>(storageKey: string, list: T[]): void {
  window.localStorage.setItem(storageKey, JSON.stringify(list));
}

export function loadCustomPanelPresets(): PanelPreset[] {
  return loadCustomList(PANEL_STORAGE_KEY, normalizePanelPreset);
}

export function loadCustomPcsPresets(): PcsPreset[] {
  return loadCustomList(PCS_STORAGE_KEY, normalizePcsPreset);
}

export function saveCustomPanelPresets(list: PanelPreset[]): void {
  saveCustomList(PANEL_STORAGE_KEY, list);
}

export function saveCustomPcsPresets(list: PcsPreset[]): void {
  saveCustomList(PCS_STORAGE_KEY, list);
}

export function upsertPresetByModel<T extends { model: string }>(list: T[], preset: T): T[] {
  const filtered = list.filter((item) => item.model !== preset.model);
  return [...filtered, preset];
}

export function buildCustomPresetExport(panelPresets: PanelPreset[], pcsPresets: PcsPreset[]): string {
  const payload: CustomPresetBundle = {
    version: 1,
    exportedAt: new Date().toISOString(),
    panelPresets,
    pcsPresets,
  };

  return JSON.stringify(payload, null, 2);
}

export function parseCustomPresetImport(
  text: string,
  defaultPanelModels: string[],
  defaultPcsModels: string[]
): {
  panelPresets: PanelPreset[];
  pcsPresets: PcsPreset[];
  warnings: string[];
} {
  const parsed = JSON.parse(text) as unknown;
  const warnings: string[] = [];

  if (!isRecord(parsed)) {
    throw new Error('JSONの形式が不正です。');
  }

  const panelSource = Array.isArray(parsed.panelPresets)
    ? parsed.panelPresets
    : Array.isArray(parsed.panels)
      ? parsed.panels
      : [];
  const pcsSource = Array.isArray(parsed.pcsPresets)
    ? parsed.pcsPresets
    : Array.isArray(parsed.pcs)
      ? parsed.pcs
      : [];

  const panelPresets: PanelPreset[] = [];
  const pcsPresets: PcsPreset[] = [];

  panelSource.forEach((item, index) => {
    const normalized = normalizePanelPreset(item);
    if (!normalized) {
      warnings.push(`パネル ${index + 1} 件目は必須項目不足のためスキップしました。`);
      return;
    }
    if (defaultPanelModels.includes(normalized.model)) {
      warnings.push(`パネル「${normalized.model}」は既定項目と重複するためスキップしました。`);
      return;
    }
    panelPresets.push(normalized);
  });

  pcsSource.forEach((item, index) => {
    const normalized = normalizePcsPreset(item);
    if (!normalized) {
      warnings.push(`PCS ${index + 1} 件目は必須項目不足のためスキップしました。`);
      return;
    }
    if (defaultPcsModels.includes(normalized.model)) {
      warnings.push(`PCS「${normalized.model}」は既定項目と重複するためスキップしました。`);
      return;
    }
    pcsPresets.push(normalized);
  });

  return {
    panelPresets: panelPresets.reduce(upsertPresetReducer, [] as PanelPreset[]),
    pcsPresets: pcsPresets.reduce(upsertPresetReducer, [] as PcsPreset[]),
    warnings,
  };
}

function upsertPresetReducer<T extends { model: string }>(list: T[], preset: T): T[] {
  return upsertPresetByModel(list, preset);
}
