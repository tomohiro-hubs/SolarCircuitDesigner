import { useCallback, useEffect, useMemo, useState } from 'react';
import { BrainCircuit, Calculator, RefreshCw, Sparkles, Zap } from 'lucide-react';
import { PanelForm } from './components/PanelForm';
import { PcsListForm } from './components/PcsListForm';
import { ConditionForm } from './components/ConditionForm';
import { ResultTable } from './components/ResultTable';
import { SummaryPanel } from './components/SummaryPanel';
import { VoltagePatternsPanel } from './components/VoltagePatternsPanel';
import { GlobalAlerts } from './components/GlobalAlerts';
import { AiSuggestionPanel } from './components/AiSuggestionPanel';
import { CustomPresetTransferPanel } from './components/CustomPresetTransferPanel';
import {
  AiDesignResponse,
  AiDesignSuggestion,
  PanelPreset,
  CircuitAssignment,
  DesignResult,
  PanelSpec,
  PcsPreset,
  PcsSpec,
  SiteCondition,
  StringDesign,
} from './types';
import { calculateDesign, calculateVocCold } from './logic/stringDesign';
import {
  convertAiAssignmentsToCircuitAssignments,
  summarizeAssignments,
} from './logic/assignmentUtils';
import pcsPresetsData from './data/pcsPresets.json';
import { DEFAULT_PANEL_PRESETS } from './data/panelPresets';
import {
  buildCustomPresetExport,
  loadCustomPanelPresets,
  loadCustomPcsPresets,
  parseCustomPresetImport,
  saveCustomPanelPresets,
  saveCustomPcsPresets,
  upsertPresetByModel,
} from './lib/presetStorage';
import { importSettingsFromExcel } from './lib/excelImport';

const INITIAL_PANEL: PanelSpec = {
  manufacturer: 'JA Solar',
  model: 'JAM66D46-720',
  voc: 49.0,
  vmp: 41.19,
  isc: 18.59,
  imp: 17.48,
  pmax: 720,
  tempCoeffVoc: -0.25,
  tempCoeffIsc: 0.04,
  moduleCount: 541,
};

const INITIAL_PCS: PcsSpec = {
  id: 'PCS1',
  manufacturer: 'HUAWEI',
  model: 'SUN2000-50KTL-NHM3',
  ratedPower: 50000,
  totalCircuits: 8,
  mpptCount: 4,
  startupVoltage: 200,
  mpptMinVoltage: 200,
  mpptMaxVoltage: 1000,
  maxInputVoltage: 1100,
  maxInputCurrentPerCircuit: 30,
  maxIscPerCircuit: 40,
  maxIscTotal: 320,
  efficiency: 98.5,
};

const INITIAL_CONDITION: SiteCondition = {
  minTemperature: -10,
  targetOverloadRatio: 120,
  manualSeriesCount: 0,
};

type AiStatus = 'idle' | 'loading' | 'success' | 'error';
type AppliedBy = 'manual' | 'rule' | 'ai';
type PresetMessage = { type: 'success' | 'error'; text: string } | null;

const DEFAULT_PCS_PRESETS = pcsPresetsData as PcsPreset[];

function hasFiniteNumbers(values: number[]): boolean {
  return values.every((value) => Number.isFinite(value));
}

function isAiReady(panel: PanelSpec, pcsList: PcsSpec[], condition: SiteCondition): boolean {
  if (pcsList.length === 0) {
    return false;
  }

  const panelNumbers = [
    panel.voc,
    panel.vmp,
    panel.isc,
    panel.imp,
    panel.pmax,
    panel.tempCoeffVoc,
    panel.tempCoeffIsc,
    panel.moduleCount,
  ];

  const conditionNumbers = [
    condition.minTemperature,
    condition.targetOverloadRatio,
  ];

  const pcsNumbers = pcsList.flatMap((pcs) => [
    pcs.ratedPower,
    pcs.totalCircuits,
    pcs.mpptCount,
    pcs.startupVoltage,
    pcs.mpptMinVoltage,
    pcs.mpptMaxVoltage,
    pcs.maxInputVoltage,
    pcs.maxInputCurrentPerCircuit,
    pcs.maxIscPerCircuit,
    pcs.maxIscTotal,
  ]);

  return hasFiniteNumbers(panelNumbers) && hasFiniteNumbers(conditionNumbers) && hasFiniteNumbers(pcsNumbers);
}

function App() {
  const [customPanelPresets, setCustomPanelPresets] = useState<PanelPreset[]>([]);
  const [customPcsPresets, setCustomPcsPresets] = useState<PcsPreset[]>([]);
  const [panel, setPanel] = useState<PanelSpec>(INITIAL_PANEL);
  const [pcsList, setPcsList] = useState<PcsSpec[]>([INITIAL_PCS]);
  const [condition, setCondition] = useState<SiteCondition>(INITIAL_CONDITION);
  const [result, setResult] = useState<DesignResult | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [manualAssignments, setManualAssignments] = useState<CircuitAssignment[] | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<AiDesignSuggestion | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus>('idle');
  const [aiErrorMessage, setAiErrorMessage] = useState<string | null>(null);
  const [appliedBy, setAppliedBy] = useState<AppliedBy>('rule');
  const [presetMessage, setPresetMessage] = useState<PresetMessage>(null);

  const panelPresets = useMemo(
    () => [...DEFAULT_PANEL_PRESETS, ...customPanelPresets],
    [customPanelPresets]
  );
  const pcsPresets = useMemo(
    () => [...DEFAULT_PCS_PRESETS, ...customPcsPresets],
    [customPcsPresets]
  );

  useEffect(() => {
    setCustomPanelPresets(loadCustomPanelPresets());
    setCustomPcsPresets(loadCustomPcsPresets());
  }, []);

  const handlePanelChange = useCallback((field: keyof PanelSpec, value: string | number) => {
    setPanel((prev) => ({ ...prev, [field]: value }));
    setAiSuggestion(null);
    setAiStatus('idle');
    setAiErrorMessage(null);
  }, []);

  const handlePanelPresetSelect = useCallback((model: string) => {
    const preset = panelPresets.find((item) => item.model === model);
    if (!preset) {
      return;
    }

    setPanel((prev) => ({
      ...prev,
      ...preset,
    }));
    setPresetMessage({
      type: 'success',
      text: `パネル項目「${model}」を反映しました。`,
    });
  }, [panelPresets]);

  const handleSaveCustomPanel = useCallback(() => {
    if (!panel.manufacturer.trim() || !panel.model.trim()) {
      setPresetMessage({ type: 'error', text: 'パネル保存にはメーカーと型式が必要です。' });
      return;
    }

    const nextPreset: PanelPreset = {
      manufacturer: panel.manufacturer.trim(),
      model: panel.model.trim(),
      voc: panel.voc,
      vmp: panel.vmp,
      isc: panel.isc,
      imp: panel.imp,
      pmax: panel.pmax,
      tempCoeffVoc: panel.tempCoeffVoc,
      tempCoeffIsc: panel.tempCoeffIsc,
    };

    const values = [
      nextPreset.voc,
      nextPreset.vmp,
      nextPreset.isc,
      nextPreset.imp,
      nextPreset.pmax,
      nextPreset.tempCoeffVoc,
      nextPreset.tempCoeffIsc,
    ];
    if (!hasFiniteNumbers(values)) {
      setPresetMessage({ type: 'error', text: 'パネル保存前に数値項目をすべて確認してください。' });
      return;
    }

    if (DEFAULT_PANEL_PRESETS.some((item) => item.model === nextPreset.model)) {
      setPresetMessage({ type: 'error', text: `パネル「${nextPreset.model}」は既定項目と重複するため保存できません。` });
      return;
    }

    setCustomPanelPresets((prev) => {
      const next = upsertPresetByModel(prev, nextPreset);
      saveCustomPanelPresets(next);
      return next;
    });
    setPresetMessage({ type: 'success', text: `パネル「${nextPreset.model}」をカスタム項目として保存しました。` });
  }, [panel]);

  const handlePcsChange = useCallback((id: string, field: keyof PcsSpec, value: string | number) => {
    setPcsList((prev) => prev.map((pcs) => (pcs.id === id ? { ...pcs, [field]: value } : pcs)));
    setAiSuggestion(null);
    setAiStatus('idle');
    setAiErrorMessage(null);
  }, []);

  const handlePcsPresetSelect = useCallback((id: string, model: string) => {
    const preset = pcsPresets.find((item) => item.model === model);
    if (!preset) {
      return;
    }

    setPcsList((prev) => prev.map((pcs) => (pcs.id === id ? { ...pcs, ...preset } : pcs)));
    setPresetMessage({
      type: 'success',
      text: `PCS項目「${model}」を ${id} に反映しました。`,
    });
  }, [pcsPresets]);

  const handleSaveCustomPcs = useCallback((id: string) => {
    const pcs = pcsList.find((item) => item.id === id);
    if (!pcs) {
      return;
    }

    if (!pcs.manufacturer.trim() || !pcs.model.trim()) {
      setPresetMessage({ type: 'error', text: `${id} の保存にはメーカーと型式が必要です。` });
      return;
    }

    const nextPreset: PcsPreset = {
      manufacturer: pcs.manufacturer.trim(),
      model: pcs.model.trim(),
      ratedPower: pcs.ratedPower,
      totalCircuits: pcs.totalCircuits,
      mpptCount: pcs.mpptCount,
      ratedInputVoltage: pcs.ratedInputVoltage,
      startupVoltage: pcs.startupVoltage,
      mpptMinVoltage: pcs.mpptMinVoltage,
      mpptMaxVoltage: pcs.mpptMaxVoltage,
      maxInputVoltage: pcs.maxInputVoltage,
      maxInputCurrentPerCircuit: pcs.maxInputCurrentPerCircuit,
      maxIscPerCircuit: pcs.maxIscPerCircuit,
      maxIscTotal: pcs.maxIscTotal,
      efficiency: pcs.efficiency,
    };

    const values = [
      nextPreset.ratedPower,
      nextPreset.totalCircuits,
      nextPreset.mpptCount,
      nextPreset.startupVoltage,
      nextPreset.mpptMinVoltage,
      nextPreset.mpptMaxVoltage,
      nextPreset.maxInputVoltage,
      nextPreset.maxInputCurrentPerCircuit,
      nextPreset.maxIscPerCircuit,
      nextPreset.maxIscTotal,
      nextPreset.efficiency,
    ];
    if (!hasFiniteNumbers(values)) {
      setPresetMessage({ type: 'error', text: `${id} の保存前に数値項目をすべて確認してください。` });
      return;
    }

    if (DEFAULT_PCS_PRESETS.some((item) => item.model === nextPreset.model)) {
      setPresetMessage({ type: 'error', text: `PCS「${nextPreset.model}」は既定項目と重複するため保存できません。` });
      return;
    }

    setCustomPcsPresets((prev) => {
      const next = upsertPresetByModel(prev, nextPreset);
      saveCustomPcsPresets(next);
      return next;
    });
    setPresetMessage({ type: 'success', text: `${id} を PCSカスタム項目「${nextPreset.model}」として保存しました。` });
  }, [pcsList]);

  const handleAddPcs = useCallback(() => {
    setPcsList((prev) => [...prev, { ...INITIAL_PCS, id: `PCS${prev.length + 1}` }]);
    setAiSuggestion(null);
    setAiStatus('idle');
    setAiErrorMessage(null);
  }, []);

  const handleExportCustomPresets = useCallback(() => {
    const content = buildCustomPresetExport(customPanelPresets, customPcsPresets);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `solar-custom-presets-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    setPresetMessage({ type: 'success', text: 'カスタム項目をJSONでエクスポートしました。' });
  }, [customPanelPresets, customPcsPresets]);

  const handleImportCustomPresets = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const imported = parseCustomPresetImport(
        text,
        DEFAULT_PANEL_PRESETS.map((preset) => preset.model),
        DEFAULT_PCS_PRESETS.map((preset) => preset.model)
      );

      const nextPanels = imported.panelPresets.reduce(upsertPresetByModel, customPanelPresets);
      const nextPcs = imported.pcsPresets.reduce(upsertPresetByModel, customPcsPresets);

      setCustomPanelPresets(nextPanels);
      setCustomPcsPresets(nextPcs);
      saveCustomPanelPresets(nextPanels);
      saveCustomPcsPresets(nextPcs);

      const baseMessage = `インポート完了: パネル ${imported.panelPresets.length} 件 / PCS ${imported.pcsPresets.length} 件`;
      setPresetMessage({
        type: imported.warnings.length > 0 ? 'error' : 'success',
        text: imported.warnings.length > 0
          ? `${baseMessage}。${imported.warnings.join(' / ')}`
          : baseMessage,
      });
    } catch (error) {
      setPresetMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'カスタム項目のインポートに失敗しました。',
      });
    }
  }, [customPanelPresets, customPcsPresets]);

  const handleDeletePanelPreset = useCallback((model: string) => {
    setCustomPanelPresets((prev) => {
      const next = prev.filter((preset) => preset.model !== model);
      saveCustomPanelPresets(next);
      return next;
    });
    setPresetMessage({ type: 'success', text: `パネル「${model}」を削除しました。` });
  }, []);

  const handleDeletePcsPreset = useCallback((model: string) => {
    setCustomPcsPresets((prev) => {
      const next = prev.filter((preset) => preset.model !== model);
      saveCustomPcsPresets(next);
      return next;
    });
    setPresetMessage({ type: 'success', text: `PCS「${model}」を削除しました。` });
  }, []);

  const resetDerivedStates = useCallback(() => {
    setResult(null);
    setManualAssignments(null);
    setAiSuggestion(null);
    setAiStatus('idle');
    setAiErrorMessage(null);
    setAppliedBy('rule');
  }, []);

  const handleImportExcelSettings = useCallback(async (file: File) => {
    try {
      const imported = await importSettingsFromExcel(file, panelPresets, pcsPresets);
      setPanel(imported.panel);
      setPcsList(imported.pcsList);
      setCondition(imported.condition);
      resetDerivedStates();
      setPresetMessage({
        type: imported.warnings.length > 0 ? 'error' : 'success',
        text: imported.warnings.length > 0
          ? `Excelを反映しました。${imported.warnings.join(' / ')}`
          : 'Excelの設定数値を反映しました。',
      });
    } catch (error) {
      setPresetMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Excelの読込に失敗しました。',
      });
    }
  }, [panelPresets, pcsPresets, resetDerivedStates]);

  const handleRemovePcs = useCallback((id: string) => {
    setPcsList((prev) => prev.filter((pcs) => pcs.id !== id));
    setAiSuggestion(null);
    setAiStatus('idle');
    setAiErrorMessage(null);
  }, []);

  const handleConditionChange = useCallback((field: keyof SiteCondition, value: number) => {
    setCondition((prev) => ({ ...prev, [field]: value }));
    setAiSuggestion(null);
    setAiStatus('idle');
    setAiErrorMessage(null);
  }, []);

  const runRuleDesign = useCallback((): DesignResult => calculateDesign(panel, pcsList, condition), [panel, pcsList, condition]);

  const handleCalculate = useCallback(() => {
    setIsCalculating(true);
    setTimeout(() => {
      try {
        const nextResult = runRuleDesign();
        setResult(nextResult);
        setManualAssignments(null);
        setAiSuggestion(null);
        setAiStatus('idle');
        setAiErrorMessage(null);
        setAppliedBy('rule');
      } catch (error) {
        console.error(error);
        alert('計算中にエラーが発生しました');
      } finally {
        setIsCalculating(false);
      }
    }, 400);
  }, [runRuleDesign]);

  const handleAssignmentChange = useCallback((pcsId: string, circuitIndex: number, change: number) => {
    if (!result) {
      return;
    }

    const currentAssignments = manualAssignments ?? result.assignments;
    const nextAssignments = currentAssignments.map((assignment) => {
      if (assignment.pcsId !== pcsId || assignment.circuitIndex !== circuitIndex) {
        return assignment;
      }

      const currentSeries = assignment.stringDesign?.seriesModules ?? 0;
      const nextSeries = Math.max(0, currentSeries + change);
      let nextStringDesign: StringDesign | null = null;

      if (nextSeries > 0) {
        const vocColdModule = calculateVocCold(panel, condition.minTemperature);
        nextStringDesign = {
          seriesModules: nextSeries,
          vmpString: panel.vmp * nextSeries,
          vocStringCold: vocColdModule * nextSeries,
        };
      }

      return {
        ...assignment,
        stringDesign: nextStringDesign,
        currentImp: nextStringDesign ? panel.imp : 0,
        currentIsc: nextStringDesign ? panel.isc : 0,
      };
    });

    setManualAssignments(nextAssignments);
    setAppliedBy('manual');
  }, [condition.minTemperature, manualAssignments, panel, result]);

  const finalResult = useMemo(() => {
    if (!result) {
      return null;
    }

    if (!manualAssignments) {
      return result;
    }

    return summarizeAssignments(panel, pcsList, condition, manualAssignments);
  }, [condition, manualAssignments, panel, pcsList, result]);

  const handleAiDesign = useCallback(async () => {
    if (!isAiReady(panel, pcsList, condition)) {
      setAiStatus('error');
      setAiErrorMessage('AI自動設計に必要な入力が不足しています。パネル・PCS・設置条件を確認してください。');
      return;
    }

    setAiStatus('loading');
    setAiErrorMessage(null);

    try {
      const baselineResult = finalResult ?? result ?? runRuleDesign();

      if (!result) {
        setResult(baselineResult);
        setAppliedBy('rule');
      }

      const response = await fetch(
        (import.meta.env.VITE_AI_DESIGN_ENDPOINT as string | undefined) ?? '/api/ai-design',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            panel,
            pcsList,
            condition,
            baselineResult,
          }),
        }
      );

      const payload = (await response.json()) as Partial<AiDesignResponse> & {
        error?: string;
        details?: string[];
      };

      if (!response.ok || !payload.suggestion) {
        const detailMessage = Array.isArray(payload.details) && payload.details.length > 0
          ? ` ${payload.details.join(' / ')}`
          : '';
        throw new Error((payload.error ?? 'AI自動設計の取得に失敗しました。') + detailMessage);
      }

      setAiSuggestion(payload.suggestion);
      setAiStatus('success');
    } catch (error) {
      console.error(error);
      setAiStatus('error');
      setAiErrorMessage(
        error instanceof Error ? error.message : 'AI自動設計の取得に失敗しました。'
      );
    }
  }, [condition, finalResult, panel, pcsList, result, runRuleDesign]);

  const applyAiSuggestion = useCallback(() => {
    if (!aiSuggestion) {
      return;
    }

    const nextAssignments = convertAiAssignmentsToCircuitAssignments(
      panel,
      pcsList,
      condition,
      aiSuggestion.assignments
    );

    setManualAssignments(nextAssignments);
    setAppliedBy('ai');
  }, [aiSuggestion, condition, panel, pcsList]);

  const dismissAiSuggestion = useCallback(() => {
    setAiSuggestion(null);
    setAiStatus('idle');
    setAiErrorMessage(null);
  }, []);

  const aiButtonDisabled = aiStatus === 'loading' || isCalculating || !isAiReady(panel, pcsList, condition);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 min-h-16 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-orange-400 to-red-500 text-white p-2 rounded-lg shadow-md">
              <Zap size={20} fill="currentColor" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-slate-900 leading-none">Solar Circuit Designer</h1>
              <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">PV Plant Engineering Tool</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleAiDesign}
              disabled={aiButtonDisabled}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {aiStatus === 'loading' ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  AI検討中...
                </>
              ) : (
                <>
                  <BrainCircuit size={16} />
                  AIで自動設計
                </>
              )}
            </button>
            <div className="hidden md:block text-xs text-slate-400 text-right">
              <p>Last Updated: 2026.07.06</p>
              <p>Version 1.4.0</p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
          <div className="xl:col-span-5 space-y-6 xl:sticky xl:top-24 overflow-y-auto xl:max-h-[calc(100vh-8rem)] scrollbar-hide pb-4">
            <CustomPresetTransferPanel
              panelPresetNames={customPanelPresets.map((preset) => preset.model)}
              pcsPresetNames={customPcsPresets.map((preset) => preset.model)}
              message={presetMessage}
              onExport={handleExportCustomPresets}
              onImport={handleImportCustomPresets}
              onImportExcel={handleImportExcelSettings}
              onDeletePanelPreset={handleDeletePanelPreset}
              onDeletePcsPreset={handleDeletePcsPreset}
            />
            <PanelForm
              panel={panel}
              presets={panelPresets}
              onChange={handlePanelChange}
              onPresetSelect={handlePanelPresetSelect}
              onSaveCustom={handleSaveCustomPanel}
            />
            <PcsListForm
              pcsList={pcsList}
              presets={pcsPresets}
              onAdd={handleAddPcs}
              onRemove={handleRemovePcs}
              onChange={handlePcsChange}
              onPresetSelect={handlePcsPresetSelect}
              onSaveCustom={handleSaveCustomPcs}
            />
            <ConditionForm condition={condition} onChange={handleConditionChange} />

            <button
              onClick={handleCalculate}
              disabled={isCalculating}
              className="w-full py-4 bg-slate-900 hover:bg-slate-800 active:bg-slate-950 text-white rounded-xl font-bold text-lg shadow-lg hover:shadow-slate-900/20 transition-all flex items-center justify-center gap-3 disabled:opacity-70 disabled:cursor-not-allowed transform active:scale-[0.99]"
            >
              {isCalculating ? (
                <>
                  <RefreshCw className="animate-spin" />
                  Checking Constraints...
                </>
              ) : (
                <>
                  <Calculator />
                  設計シミュレーション実行
                </>
              )}
            </button>
          </div>

          <div className="xl:col-span-7 space-y-6 min-h-[calc(100vh-8rem)]">
            {aiErrorMessage ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
                {aiErrorMessage}
              </div>
            ) : null}

            {aiSuggestion ? (
              <AiSuggestionPanel
                suggestion={aiSuggestion}
                isApplying={false}
                applied={appliedBy === 'ai'}
                onApply={applyAiSuggestion}
                onDismiss={dismissAiSuggestion}
              />
            ) : null}

            {finalResult ? (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {appliedBy === 'ai' ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700 flex items-center gap-2">
                    <Sparkles size={16} />
                    AI案を適用した状態です。必要に応じて下の割付表で微調整できます。
                  </div>
                ) : null}

                <SummaryPanel result={finalResult} panel={panel} />
                <VoltagePatternsPanel result={finalResult} pcsList={pcsList} panel={panel} />
                <ResultTable result={finalResult} onAssignmentChange={handleAssignmentChange} />
                <GlobalAlerts warnings={finalResult.globalWarnings} />
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center bg-white/50 rounded-3xl border-2 border-dashed border-slate-200 text-slate-400 p-12 text-center">
                <div className="bg-slate-100 p-6 rounded-full mb-6">
                  <Calculator size={48} className="opacity-40 text-slate-600" />
                </div>
                <h3 className="text-xl font-bold text-slate-600 mb-2">Ready to Simulate</h3>
                <p className="max-w-md mx-auto text-slate-500">
                  左側のパネル仕様・PCS構成・設置条件を入力し、「設計シミュレーション実行」または「AIで自動設計」を押してください。
                </p>
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="bg-white border-t border-slate-200 mt-auto">
        <div className="max-w-[1600px] mx-auto px-4 py-6 flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-slate-500">
          <p>&copy; 2025 Solar Circuit Designer. All rights reserved.</p>
          <div className="flex gap-6">
            <a href="#" className="hover:text-slate-800 transition-colors">利用規約</a>
            <a href="#" className="hover:text-slate-800 transition-colors">プライバシーポリシー</a>
            <a href="#" className="hover:text-slate-800 transition-colors">ヘルプ</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
