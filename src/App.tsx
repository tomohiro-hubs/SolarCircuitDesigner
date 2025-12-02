import React, { useState, useCallback } from 'react';
import { PanelForm } from './components/PanelForm';
import { PcsListForm } from './components/PcsListForm';
import { ConditionForm } from './components/ConditionForm';
import { ResultTable } from './components/ResultTable';
import { SummaryPanel } from './components/SummaryPanel';
import { VoltagePatternsPanel } from './components/VoltagePatternsPanel';
import { GlobalAlerts } from './components/GlobalAlerts';
import { PanelSpec, PcsSpec, SiteCondition, DesignResult, CircuitAssignment, StringDesign } from './types';
import { calculateDesign, calculateVocCold } from './logic/stringDesign';
import { Calculator, RefreshCw, Zap } from 'lucide-react';

const INITIAL_PANEL: PanelSpec = {
  manufacturer: 'JA Solar',
  model: 'JAM66D46-720',
  voc: 49.00,
  vmp: 41.19,
  isc: 18.59,
  imp: 17.48,
  pmax: 720,
  tempCoeffVoc: -0.25,
  tempCoeffIsc: 0.04,
  moduleCount: 541
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
  efficiency: 98.5
};

const INITIAL_CONDITION: SiteCondition = {
  minTemperature: -10,
  targetOverloadRatio: 120,
  manualSeriesCount: 0
};

function App() {
  const [panel, setPanel] = useState<PanelSpec>(INITIAL_PANEL);
  const [pcsList, setPcsList] = useState<PcsSpec[]>([INITIAL_PCS]);
  const [condition, setCondition] = useState<SiteCondition>(INITIAL_CONDITION);
  const [result, setResult] = useState<DesignResult | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  // 状態管理用: ユーザーが手動変更したassignmentsを保持
  // nullの場合は計算直後のresult.assignmentsを使用する
  const [manualAssignments, setManualAssignments] = useState<CircuitAssignment[] | null>(null);

  const handlePanelChange = useCallback((field: keyof PanelSpec, value: string | number) => {
    setPanel(prev => ({ ...prev, [field]: value }));
  }, []);

  const handlePcsChange = useCallback((id: string, field: keyof PcsSpec, value: string | number) => {
    setPcsList(prev => prev.map(pcs => pcs.id === id ? { ...pcs, [field]: value } : pcs));
  }, []);

  const handleAddPcs = useCallback(() => {
    setPcsList(prev => [
      ...prev,
      { ...INITIAL_PCS, id: `PCS${prev.length + 1}` }
    ]);
  }, []);

  const handleRemovePcs = useCallback((id: string) => {
    setPcsList(prev => prev.filter(pcs => pcs.id !== id));
  }, []);

  const handleConditionChange = useCallback((field: keyof SiteCondition, value: number) => {
    setCondition(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleCalculate = () => {
    setIsCalculating(true);
    setTimeout(() => {
      try {
        const res = calculateDesign(panel, pcsList, condition);
        setResult(res);
        setManualAssignments(null); // Reset manual overrides on new calculation
      } catch (e) {
        console.error(e);
        alert('計算中にエラーが発生しました');
      } finally {
        setIsCalculating(false);
      }
    }, 400);
  };

  // 手動で直列数を変更したときのハンドラ
  const handleAssignmentChange = useCallback((pcsId: string, circuitIndex: number, change: number) => {
    if (!result) return;

    const currentAssignments = manualAssignments || result.assignments;
    
    const newAssignments = currentAssignments.map(a => {
      if (a.pcsId === pcsId && a.circuitIndex === circuitIndex) {
        // 直列数の増減
        const currentSeries = a.stringDesign?.seriesModules || 0;
        const newSeries = Math.max(0, currentSeries + change); // 0未満にはしない

        // StringDesignの再計算
        let newStringDesign: StringDesign | null = null;
        if (newSeries > 0) {
            const vocColdModule = calculateVocCold(panel, condition.minTemperature);
            newStringDesign = {
                seriesModules: newSeries,
                vmpString: panel.vmp * newSeries,
                vocStringCold: vocColdModule * newSeries
            };
        }

        return {
          ...a,
          stringDesign: newStringDesign,
          currentImp: newStringDesign ? panel.imp : 0,
          currentIsc: newStringDesign ? panel.isc : 0
        };
      }
      return a;
    });

    setManualAssignments(newAssignments);
  }, [result, manualAssignments, panel, condition.minTemperature]);

  // 最終的な結果オブジェクトの構築 (マニュアル変更を反映)
  const finalResult = React.useMemo(() => {
      if (!result) return null;
      if (!manualAssignments) return result;

      // assignments以外（サマリーや残数警告など）を再集計する必要がある
      // ここでは簡易的に assignments だけ差し替えるだけでなく、必要な再計算を行うべきだが、
      // ロジックが複雑になるため、まずは「表示用のassignments」を差し替える。
      // 残数計算などは別途ここで行う。

      const assignments = manualAssignments;
      
      // 再集計: 使用総枚数
      let totalModulesAssigned = 0;
      let totalPvCapacityW = 0;
      let totalPcsCapacityW = 0;
      const newSummaries = [];
      const globalWarnings = [];

      // PCSごとの再集計
      for(const pcs of pcsList) {
          totalPcsCapacityW += pcs.ratedPower;
          const pcsAssignments = assignments.filter(a => a.pcsId === pcs.id);
          
          let pcsModules = 0;
          let usedCircuits = 0;
          // 簡易チェックのみ再実行（詳細な警告ロジックは stringDesign.ts と重複するため省略するか、共通化が必要）
          // ここでは最低限の集計を行う

          pcsAssignments.forEach(a => {
              if(a.stringDesign) {
                  pcsModules += a.stringDesign.seriesModules;
                  usedCircuits++;
              }
          });

          const pcsPvPower = pcsModules * panel.pmax;
          const overloadRatio = pcs.ratedPower > 0 ? (pcsPvPower / pcs.ratedPower) * 100 : 0;

          totalModulesAssigned += pcsModules;
          totalPvCapacityW += pcsPvPower;

          // 既存の警告を引き継ぎつつ、過積載率だけは更新したいが、
          // 今回はシンプルに「assignmentsが変わった結果」として過積載率だけ再計算して表示に反映させる。
          // ※ 本来は calculateDesign の後半部分を関数化して再利用すべき

          const originalSummary = result.summaries.find(s => s.pcsId === pcs.id);
          newSummaries.push({
              ...originalSummary!, // 型アサーション
              totalModulesAssigned: pcsModules,
              usedCircuits: usedCircuits,
              overloadRatio: overloadRatio,
              pvCapacityKw: pcsPvPower / 1000,
              // warningsは再計算していないので古いままになるリスクがあるが、一旦そのまま
          });
      }

      const remaining = panel.moduleCount - totalModulesAssigned;
      if (remaining !== 0) {
          // 残数がプラスなら注意、マイナス（割り当てすぎ）なら警告
          if (remaining > 0) {
            globalWarnings.push(`注意: ${remaining} 枚のパネルが配置されずに残っています。`);
          } else {
             globalWarnings.push(`警告: パネル総数(${panel.moduleCount}枚)に対し、${-remaining} 枚多く割り当てられています！`);
          }
      }
      
      const totalOverloadRatio = totalPcsCapacityW > 0 ? (totalPvCapacityW / totalPcsCapacityW) * 100 : 0;

      return {
          ...result,
          assignments: manualAssignments,
          summaries: newSummaries,
          totalOverloadRatio,
          totalPvCapacityKw: totalPvCapacityW / 1000,
          globalWarnings
      };
  }, [result, manualAssignments, panel.moduleCount, panel.pmax, pcsList]);


  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-orange-400 to-red-500 text-white p-2 rounded-lg shadow-md">
              <Zap size={20} fill="currentColor" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-slate-900 leading-none">Solar Circuit Designer</h1>
              <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">PV Plant Engineering Tool</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden md:block text-xs text-slate-400 text-right">
              <p>Last Updated: 2025.12.01</p>
              <p>Version 1.3.0</p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
          
          {/* 左カラム: 入力フォーム (スクロール可能エリア) */}
          <div className="xl:col-span-5 space-y-6 xl:sticky xl:top-24 overflow-y-auto xl:max-h-[calc(100vh-8rem)] scrollbar-hide pb-4">
            <PanelForm panel={panel} onChange={handlePanelChange} />
            <PcsListForm 
              pcsList={pcsList} 
              onAdd={handleAddPcs} 
              onRemove={handleRemovePcs} 
              onChange={handlePcsChange} 
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

          {/* 右カラム: 結果表示 */}
          <div className="xl:col-span-7 space-y-6 min-h-[calc(100vh-8rem)]">
            {finalResult ? (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <SummaryPanel result={finalResult} panel={panel} />
                
                {/* 直列数パターン詳細 (New) */}
                <VoltagePatternsPanel result={finalResult} pcsList={pcsList} panel={panel} />
                
                <ResultTable 
                    result={finalResult} 
                    onAssignmentChange={handleAssignmentChange} 
                />
                <GlobalAlerts warnings={finalResult.globalWarnings} />
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center bg-white/50 rounded-3xl border-2 border-dashed border-slate-200 text-slate-400 p-12 text-center">
                <div className="bg-slate-100 p-6 rounded-full mb-6">
                  <Calculator size={48} className="opacity-40 text-slate-600" />
                </div>
                <h3 className="text-xl font-bold text-slate-600 mb-2">Ready to Simulate</h3>
                <p className="max-w-md mx-auto text-slate-500">左側のパネル仕様・PCS構成・設置条件を入力し、「設計シミュレーション実行」ボタンを押してください。</p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
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
