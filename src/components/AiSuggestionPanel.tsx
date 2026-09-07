import React from 'react';
import { AiDesignSuggestion } from '../types';
import { VoltagePreference } from '../logic/assignmentUtils';
import { BrainCircuit, CheckCircle2, AlertTriangle, Sparkles, RefreshCw, SlidersHorizontal } from 'lucide-react';

interface Props {
  suggestion: AiDesignSuggestion;
  isApplying: boolean;
  applied: boolean;
  voltagePreference: VoltagePreference;
  isReevaluating: boolean;
  onReevaluate: (preference: VoltagePreference) => void;
  onApply: () => void;
  onDismiss: () => void;
}

const VOLTAGE_OPTIONS: { key: VoltagePreference; label: string; sub: string }[] = [
  { key: 'low', label: '電圧低め', sub: '直列少なめ' },
  { key: 'normal', label: '電圧普通', sub: '推奨・再検討' },
  { key: 'high', label: '電圧高め', sub: '直列多め' },
];

export const AiSuggestionPanel: React.FC<Props> = ({
  suggestion,
  isApplying,
  applied,
  voltagePreference,
  isReevaluating,
  onReevaluate,
  onApply,
  onDismiss,
}) => {
  return (
    <section className="bg-white rounded-2xl shadow-sm border border-cyan-200 overflow-hidden">
      <div className="bg-gradient-to-r from-cyan-50 via-sky-50 to-white px-6 py-4 border-b border-cyan-100 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-cyan-100 text-cyan-700 rounded-xl">
            <BrainCircuit size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800">AI自動設計の提案</h2>
            <p className="text-xs text-slate-500">割付案と考察を確認してから適用できます</p>
          </div>
        </div>

        {applied ? (
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
            <CheckCircle2 size={14} />
            AI案を適用済み
          </div>
        ) : null}
      </div>

      <div className="p-6 space-y-5">
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-2 text-slate-700">
            <Sparkles size={16} />
            <h3 className="text-sm font-bold">結論</h3>
          </div>
          <p className="text-sm leading-6 text-slate-700">{suggestion.summary}</p>
        </div>

        {/* 電圧の狙いを変えて再検討 */}
        <div className="rounded-xl border border-cyan-200 bg-cyan-50/50 p-4">
          <div className="flex items-center gap-2 mb-1 text-slate-700">
            <SlidersHorizontal size={16} className="text-cyan-600" />
            <h3 className="text-sm font-bold">電圧の狙いを変えて再検討</h3>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            結果を見て、ストリングの直列枚数（電圧）を調整して再計算できます。
          </p>
          <div className="grid grid-cols-3 gap-2">
            {VOLTAGE_OPTIONS.map((opt) => {
              const active = voltagePreference === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => onReevaluate(opt.key)}
                  disabled={isReevaluating}
                  title={opt.sub}
                  className={`px-3 py-2 rounded-lg text-sm font-bold border transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                    active
                      ? 'bg-cyan-600 text-white border-cyan-600 shadow'
                      : 'bg-white text-slate-700 border-slate-300 hover:border-cyan-400 hover:bg-cyan-50'
                  }`}
                >
                  {isReevaluating && active ? (
                    <span className="inline-flex items-center gap-1">
                      <RefreshCw size={12} className="animate-spin" />
                      計算中
                    </span>
                  ) : (
                    <>
                      <div>{opt.label}</div>
                      <div className={`text-[10px] font-normal ${active ? 'text-cyan-100' : 'text-slate-400'}`}>
                        {opt.sub}
                      </div>
                    </>
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            ※ 電圧高めは回路に空きが出ることがあります（適正範囲内で調整）。電圧低めは推奨直列の下限付近を狙います。
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-bold text-slate-700 mb-3">考察</h3>
            <ul className="space-y-2 text-sm text-slate-600">
              {suggestion.reasoning.map((item, index) => (
                <li key={`${item}-${index}`} className="flex gap-2">
                  <span className="mt-0.5 text-cyan-600 font-bold">{index + 1}.</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-bold text-slate-700 mb-3">注意点</h3>
            {suggestion.warnings.length > 0 ? (
              <ul className="space-y-2 text-sm text-amber-700">
                {suggestion.warnings.map((warning, index) => (
                  <li key={`${warning}-${index}`} className="flex gap-2">
                    <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                    <span>{warning}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">追加の注意点はありません。</p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-bold text-slate-700 mb-3">AIが返した回路割付</h3>
          <div className="max-h-48 overflow-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-4">PCS</th>
                  <th className="py-2 pr-4">回路</th>
                  <th className="py-2">直列数</th>
                </tr>
              </thead>
              <tbody>
                {suggestion.assignments.map((assignment) => (
                  <tr key={`${assignment.pcsId}-${assignment.circuitIndex}`} className="border-t border-slate-100 text-slate-700">
                    <td className="py-2 pr-4 font-medium">{assignment.pcsId}</td>
                    <td className="py-2 pr-4">{assignment.circuitIndex}</td>
                    <td className="py-2">{assignment.seriesModules}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onApply}
            disabled={isApplying || applied}
            className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isApplying ? 'AI案を適用中...' : applied ? 'AI案を適用済み' : 'AI案を適用'}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            破棄
          </button>
        </div>
      </div>
    </section>
  );
};
