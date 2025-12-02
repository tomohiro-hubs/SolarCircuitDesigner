import React from 'react';
import { PanelSpec } from '../types';
import { Sun } from 'lucide-react';
import { InputField } from './ui/InputField';

interface Props {
  panel: PanelSpec;
  onChange: (field: keyof PanelSpec, value: string | number) => void;
}

export const PanelForm: React.FC<Props> = ({ panel, onChange }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type } = e.target;
    const val = type === 'number' ? parseFloat(value) : value;
    onChange(name as keyof PanelSpec, val);
  };

  return (
    <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="bg-gradient-to-r from-orange-50 to-white px-6 py-4 border-b border-orange-100 flex items-center gap-3">
        <div className="p-2 bg-orange-100 text-orange-600 rounded-lg">
          <Sun size={20} />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-800">パネル仕様</h2>
          <p className="text-xs text-slate-500">使用する太陽光モジュールのスペックを入力</p>
        </div>
      </div>
      
      <div className="p-6 space-y-6">
        {/* 基本情報 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <InputField
            label="メーカー"
            name="manufacturer"
            value={panel.manufacturer}
            onChange={handleChange}
            placeholder="例: JA Solar"
          />
          <InputField
            label="型式"
            name="model"
            value={panel.model}
            onChange={handleChange}
            placeholder="例: JAM66D46-720"
          />
        </div>

        <hr className="border-slate-100" />

        {/* 電気的特性 */}
        <div>
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">電気的特性 (STC)</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <InputField
              label="公称最大出力 Pmax"
              name="pmax"
              type="number"
              unit="W"
              value={panel.pmax || ''}
              onChange={handleChange}
            />
            <InputField
              label="総枚数"
              name="moduleCount"
              type="number"
              unit="枚"
              value={panel.moduleCount || ''}
              onChange={handleChange}
              className="bg-orange-50/30 rounded-lg -mx-2 px-2 pt-1 pb-2" // 強調
            />
            <InputField
              label="開放電圧 Voc"
              name="voc"
              type="number"
              step="0.01"
              unit="V"
              value={panel.voc || ''}
              onChange={handleChange}
            />
            <InputField
              label="動作電圧 Vmp"
              name="vmp"
              type="number"
              step="0.01"
              unit="V"
              value={panel.vmp || ''}
              onChange={handleChange}
            />
            <InputField
              label="短絡電流 Isc"
              name="isc"
              type="number"
              step="0.01"
              unit="A"
              value={panel.isc || ''}
              onChange={handleChange}
            />
            <InputField
              label="動作電流 Imp"
              name="imp"
              type="number"
              step="0.01"
              unit="A"
              value={panel.imp || ''}
              onChange={handleChange}
            />
          </div>
        </div>

        <hr className="border-slate-100" />

        {/* 温度係数 */}
        <div>
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">温度係数</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <InputField
              label="温度係数 Voc"
              name="tempCoeffVoc"
              type="number"
              step="0.01"
              unit="%/°C"
              value={panel.tempCoeffVoc || ''}
              onChange={handleChange}
              placeholder="-0.25"
            />
            <InputField
              label="温度係数 Isc"
              name="tempCoeffIsc"
              type="number"
              step="0.01"
              unit="%/°C"
              value={panel.tempCoeffIsc || ''}
              onChange={handleChange}
              placeholder="0.04"
            />
          </div>
        </div>
      </div>
    </section>
  );
};
