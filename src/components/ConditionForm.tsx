import React from 'react';
import { SiteCondition } from '../types';
import { ThermometerSnowflake } from 'lucide-react';
import { InputField } from './ui/InputField';

interface Props {
  condition: SiteCondition;
  onChange: (field: keyof SiteCondition, value: number) => void;
}

export const ConditionForm: React.FC<Props> = ({ condition, onChange }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    onChange(name as keyof SiteCondition, parseFloat(value));
  };

  return (
    <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
       <div className="bg-gradient-to-r from-cyan-50 to-white px-6 py-4 border-b border-cyan-100 flex items-center gap-3">
        <div className="p-2 bg-cyan-100 text-cyan-600 rounded-lg">
          <ThermometerSnowflake size={20} />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-800">設置条件</h2>
          <p className="text-xs text-slate-500">環境条件と設計目標</p>
        </div>
      </div>
      
      <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
        <InputField
          label="想定最低気温"
          name="minTemperature"
          type="number"
          unit="°C"
          value={condition.minTemperature}
          onChange={handleChange}
          helperText="Vocの上昇計算に使用します"
        />
        <InputField
          label="目標過積載率"
          name="targetOverloadRatio"
          type="number"
          unit="%"
          value={condition.targetOverloadRatio}
          onChange={handleChange}
          helperText="アラート判定の基準値"
        />
        <InputField
          label="直列数 (任意指定)"
          name="manualSeriesCount"
          type="number"
          unit="枚"
          value={condition.manualSeriesCount || ''}
          onChange={handleChange}
          placeholder="自動計算"
          helperText="空欄の場合は自動で最大枚数を選択"
          className="bg-indigo-50/30 rounded-lg -mx-2 px-2 pt-1 pb-2"
        />
      </div>
    </section>
  );
};
