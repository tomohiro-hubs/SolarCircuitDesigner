import React from 'react';
import { DesignResult, PanelSpec } from '../types';
import { AlertTriangle, CheckCircle2, Info, Zap, Server, BatteryWarning } from 'lucide-react';
import clsx from 'clsx';

interface Props {
  result: DesignResult;
  panel: PanelSpec;
}

export const SummaryPanel: React.FC<Props> = ({ result, panel }) => {
  if (result.summaries.length === 0) return null;

  const hasGlobalWarnings = result.globalWarnings.length > 0;

  return (
    <section className="space-y-6">
      {/* 1. メインKPIカード */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* 直列数 & 電圧情報 (New) */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200 flex flex-col justify-between relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 text-indigo-500 group-hover:scale-110 transition-transform">
             <Zap size={60} />
          </div>
          <div>
             <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">設計: 直列数 & 電圧</p>
             <div className="flex items-baseline gap-1">
               <span className="text-3xl font-bold text-indigo-700">
                 {result.assignments[0]?.stringDesign?.seriesModules || 0}
               </span>
               <span className="text-sm font-medium text-slate-500">枚直列</span>
             </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 space-y-1">
            <div className="flex justify-between items-center text-xs">
               <span className="text-slate-500">動作電圧 (Vmp)</span>
               <span className="font-bold text-slate-700">
                 {result.assignments[0]?.stringDesign?.vmpString.toFixed(1) || 0} V
               </span>
            </div>
            <div className="flex justify-between items-center text-xs">
               <span className="text-slate-500">低温時Voc</span>
               <span className="font-bold text-slate-700">
                  {result.assignments[0]?.stringDesign?.vocStringCold.toFixed(1) || 0} V
               </span>
            </div>
          </div>
        </div>

        {/* PV容量 */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200 flex flex-col justify-between relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 text-orange-500 group-hover:scale-110 transition-transform">
            <Zap size={60} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">PV システム容量</p>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold text-slate-800">{result.totalPvCapacityKw.toFixed(2)}</span>
              <span className="text-sm font-medium text-slate-500">kW</span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex justify-between items-center text-xs">
            <span className="text-slate-500">パネル総数</span>
            <span className="font-bold text-slate-700">{panel.moduleCount} 枚</span>
          </div>
        </div>

        {/* PCS容量 */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200 flex flex-col justify-between relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 text-blue-500 group-hover:scale-110 transition-transform">
            <Server size={60} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">PCS 定格出力合計</p>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold text-slate-800">{result.totalPcsCapacityKw.toFixed(2)}</span>
              <span className="text-sm font-medium text-slate-500">kW</span>
            </div>
          </div>
           <div className="mt-4 pt-3 border-t border-slate-100 flex justify-between items-center text-xs">
            <span className="text-slate-500">台数</span>
            <span className="font-bold text-slate-700">{result.summaries.length} 台</span>
          </div>
        </div>

        {/* 過積載率 */}
        <div className={clsx(
          "rounded-xl p-5 shadow-sm border flex flex-col justify-between relative overflow-hidden group",
          result.totalOverloadRatio > 150 
            ? "bg-red-50 border-red-200" 
            : "bg-emerald-50 border-emerald-200"
        )}>
          <div className={clsx(
            "absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform",
             result.totalOverloadRatio > 150 ? "text-red-600" : "text-emerald-600"
          )}>
            <BatteryWarning size={60} />
          </div>
          <div>
            <p className={clsx(
              "text-xs font-bold uppercase tracking-wider mb-1",
              result.totalOverloadRatio > 150 ? "text-red-400" : "text-emerald-600"
            )}>全体過積載率</p>
            <div className="flex items-baseline gap-1">
              <span className={clsx(
                "text-3xl font-bold",
                 result.totalOverloadRatio > 150 ? "text-red-700" : "text-emerald-700"
              )}>{result.totalOverloadRatio.toFixed(1)}</span>
              <span className={clsx(
                "text-sm font-medium",
                 result.totalOverloadRatio > 150 ? "text-red-500" : "text-emerald-600"
              )}>%</span>
            </div>
          </div>
           <div className={clsx(
             "mt-4 pt-3 border-t flex justify-between items-center text-xs",
             result.totalOverloadRatio > 150 ? "border-red-100" : "border-emerald-100"
           )}>
            <span className={clsx(result.totalOverloadRatio > 150 ? "text-red-400" : "text-emerald-600")}>Status</span>
             <span className={clsx(
               "font-bold",
                result.totalOverloadRatio > 150 ? "text-red-700" : "text-emerald-700"
             )}>
              {result.totalOverloadRatio > 150 ? "High" : "Optimal"}
            </span>
          </div>
        </div>
      </div>

      {/* 3. PCS別詳細カード */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {result.summaries.map(summary => {
          const hasWarning = summary.warnings.length > 0;
          
          return (
            <div key={summary.pcsId} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col">
              <div className="bg-slate-50 px-4 py-3 border-b border-slate-100 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Server size={16} className="text-slate-400" />
                  <span className="font-bold text-slate-700 text-sm">{summary.pcsId}</span>
                </div>
                <span className={clsx(
                  "text-[10px] px-2 py-1 rounded-full font-bold",
                  hasWarning ? "bg-red-100 text-red-600" : "bg-green-100 text-green-600"
                )}>
                  {hasWarning ? "要確認" : "OK"}
                </span>
              </div>
              
              <div className="p-4 flex-1 flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="space-y-1">
                    <span className="text-xs text-slate-400">PV入力</span>
                    <p className="font-bold text-slate-700">{summary.pvCapacityKw.toFixed(2)} <span className="text-xs font-normal">kW</span></p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-slate-400">過積載率</span>
                    <p className={clsx(
                      "font-bold",
                      summary.overloadRatio > 150 ? "text-red-600" : "text-slate-700"
                    )}>
                      {summary.overloadRatio.toFixed(1)} <span className="text-xs font-normal">%</span>
                    </p>
                  </div>
                </div>

                {/* 警告リスト */}
                {hasWarning ? (
                  <div className="mt-auto bg-red-50/50 rounded border border-red-100 p-2 space-y-1.5">
                    {summary.warnings.map((w, i) => (
                      <div key={i} className="flex items-start gap-2 text-red-700 text-xs leading-snug">
                        <Info size={12} className="mt-0.5 flex-shrink-0 opacity-70" />
                        <span>{w}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-auto flex items-center gap-2 text-xs text-green-600 bg-green-50/50 p-2 rounded border border-green-100">
                    <CheckCircle2 size={14} />
                    <span>すべての制約を満たしています</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
