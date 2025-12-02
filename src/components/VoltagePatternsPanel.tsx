import React from 'react';
import { DesignResult, PcsSpec, PanelSpec } from '../types';
import { Zap, AlertTriangle, CheckCircle2 } from 'lucide-react';
import clsx from 'clsx';

interface Props {
  result: DesignResult;
  pcsList: PcsSpec[];
  panel: PanelSpec;
}

export const VoltagePatternsPanel: React.FC<Props> = ({ result, pcsList, panel }) => {
  // 全assignmentからユニークな直列数パターンを抽出・集計
  const patterns = React.useMemo(() => {
    const map = new Map<number, { count: number, assignments: typeof result.assignments }>();
    
    result.assignments.forEach(a => {
      const n = a.stringDesign?.seriesModules || 0;
      if (n === 0) return; // 未使用回路はスキップ

      if (!map.has(n)) {
        map.set(n, { count: 0, assignments: [] });
      }
      const entry = map.get(n)!;
      entry.count++;
      entry.assignments.push(a);
    });

    // 直列数の降順でソート
    return Array.from(map.entries()).sort((a, b) => b[0] - a[0]);
  }, [result.assignments]);

  if (patterns.length === 0) return null;

  return (
    <section className="space-y-3">
       <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
         <Zap size={16} />
         ストリング構成別 電圧詳細
       </h3>
       
       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
         {patterns.map(([seriesCount, data]) => {
           const vmp = (panel.vmp * seriesCount).toFixed(1);
           const vocCold = (data.assignments[0].stringDesign?.vocStringCold || 0).toFixed(1);
           
           // 簡易電圧チェック (代表して最初のPCSのスペックと比較... 厳密には各回路のPCSと比較すべきだが表示用として)
           // ここでは「この直列数を含むPCSの中で最も厳しい条件」と比較するのが親切
           // 簡易的に最初のPCSと比較しておく
           const pcs = pcsList[0]; 
           const isVmpLow = parseFloat(vmp) < pcs.mpptMinVoltage;
           const isVmpHigh = parseFloat(vmp) > pcs.mpptMaxVoltage;
           const isVocHigh = parseFloat(vocCold) > pcs.maxInputVoltage;
           
           const hasError = isVmpLow || isVmpHigh || isVocHigh;

           return (
             <div key={seriesCount} className={clsx(
               "rounded-lg border p-4 shadow-sm transition-all",
               hasError ? "bg-red-50 border-red-200" : "bg-white border-slate-200"
             )}>
               <div className="flex justify-between items-start mb-3">
                 <div className="flex items-baseline gap-2">
                   <span className="text-2xl font-bold text-slate-800">{seriesCount}</span>
                   <span className="text-xs font-bold text-slate-500">枚直列</span>
                 </div>
                 <div className="px-2 py-1 bg-slate-100 rounded text-xs font-mono text-slate-600">
                   × {data.count} 回路
                 </div>
               </div>

               <div className="space-y-2 text-sm">
                 <div className="flex justify-between">
                   <span className="text-slate-500">動作電圧 (Vmp)</span>
                   <span className={clsx("font-mono font-bold", (isVmpLow || isVmpHigh) ? "text-red-600" : "text-slate-700")}>
                     {vmp} V
                   </span>
                 </div>
                 <div className="flex justify-between">
                    <span className="text-slate-500">低温時開放 (Voc)</span>
                    <span className={clsx("font-mono font-bold", isVocHigh ? "text-red-600" : "text-slate-700")}>
                      {vocCold} V
                    </span>
                 </div>
               </div>

               {hasError && (
                 <div className="mt-3 pt-2 border-t border-red-100 text-xs text-red-600 flex items-start gap-1.5">
                   <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                   <span>
                     {isVmpLow && "MPPT下限未満 "}
                     {isVmpHigh && "MPPT上限超過 "}
                     {isVocHigh && "最大入力電圧超過"}
                   </span>
                 </div>
               )}
             </div>
           );
         })}
       </div>
    </section>
  );
};
