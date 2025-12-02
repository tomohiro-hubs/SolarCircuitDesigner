import React from 'react';
import { DesignResult, CircuitAssignment } from '../types';
import clsx from 'clsx';
import { Grip, MousePointerClick } from 'lucide-react';

interface Props {
  result: DesignResult;
  onAssignmentChange?: (pcsId: string, circuitIndex: number, change: number) => void;
}

export const ResultTable: React.FC<Props> = ({ result, onAssignmentChange }) => {
  if (result.assignments.length === 0) return null;

  // PCSごとにグループ化
  const assignmentsByPcs = result.assignments.reduce((acc, curr) => {
    if (!acc[curr.pcsId]) acc[curr.pcsId] = [];
    acc[curr.pcsId].push(curr);
    return acc;
  }, {} as Record<string, CircuitAssignment[]>);

  const pcsIds = Object.keys(assignmentsByPcs);
  const maxCircuits = Math.max(...pcsIds.map(id => assignmentsByPcs[id].length));
  
  // 1〜maxCircuitsまでの行を作る
  const rows = Array.from({ length: maxCircuits }, (_, i) => i + 1);

  const handleCellClick = (e: React.MouseEvent, pcsId: string, circuitIndex: number) => {
      if (!onAssignmentChange) return;
      e.preventDefault(); // Context menu抑止など
      
      // 左クリック: +1, 右クリック(コンテキストメニュー): -1
      // ReactのonClickは左クリックのみ。右クリックはonContextMenu
      onAssignmentChange(pcsId, circuitIndex, 1);
  };

  const handleCellContextMenu = (e: React.MouseEvent, pcsId: string, circuitIndex: number) => {
      if (!onAssignmentChange) return;
      e.preventDefault();
      onAssignmentChange(pcsId, circuitIndex, -1);
  };

  return (
    <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-full">
      <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Grip className="text-slate-500" size={20} />
          <div>
            <h3 className="font-bold text-slate-700 leading-none">回路割付表 (Matrix)</h3>
            <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-400">
                <MousePointerClick size={12} />
                <span>左クリック: +1 / 右クリック: -1</span>
            </div>
          </div>
        </div>
        <div className="flex gap-4 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-emerald-500 rounded-sm"></div>
            <span className="text-slate-600">使用中</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-slate-100 border border-slate-200 rounded-sm"></div>
            <span className="text-slate-600">未使用</span>
          </div>
        </div>
      </div>
      
      <div className="overflow-x-auto flex-1">
        <table className="w-full text-sm text-left text-slate-600 border-collapse">
          <thead className="text-xs text-slate-700 uppercase bg-slate-100 sticky top-0 z-10 shadow-sm">
            <tr>
              <th className="px-4 py-3 w-16 text-center font-bold border-b border-slate-200 bg-slate-100">
                回路No
              </th>
              {pcsIds.map(pcsId => (
                <th key={pcsId} className="px-4 py-3 text-center border-l border-b border-slate-200 min-w-[100px] font-bold bg-slate-100">
                  {pcsId}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(rowNum => (
              <tr key={rowNum} className="hover:bg-slate-50 transition-colors">
                <td className="px-2 py-2 font-mono font-medium text-center text-slate-500 bg-slate-50/50 border-b border-slate-100 text-xs">
                  {String(rowNum).padStart(2, '0')}
                </td>
                {pcsIds.map(pcsId => {
                  const assignment = assignmentsByPcs[pcsId].find(a => a.circuitIndex === rowNum);
                  const modules = assignment?.stringDesign?.seriesModules || 0;
                  const isEmpty = modules === 0;
                  
                  return (
                    <td 
                        key={`${pcsId}-${rowNum}`} 
                        className="p-1 border-l border-b border-slate-100 text-center align-middle cursor-pointer select-none"
                        onClick={(e) => handleCellClick(e, pcsId, rowNum)}
                        onContextMenu={(e) => handleCellContextMenu(e, pcsId, rowNum)}
                        title="クリックで増減"
                    >
                      <div className={clsx(
                        "h-8 w-full flex items-center justify-center rounded text-xs font-bold transition-all active:scale-95",
                        isEmpty 
                          ? "bg-slate-50 text-slate-300 border border-slate-100 hover:bg-slate-100" 
                          : "bg-emerald-500 text-white shadow-sm border border-emerald-600 hover:bg-emerald-400"
                      )}>
                        {isEmpty ? "-" : modules}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};
