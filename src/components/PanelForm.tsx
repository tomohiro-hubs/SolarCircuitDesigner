import React from 'react';
import { PanelPreset, PanelSpec } from '../types';
import { Save, Sun } from 'lucide-react';
import { InputField } from './ui/InputField';

interface Props {
  panel: PanelSpec;
  presets: PanelPreset[];
  onChange: (field: keyof PanelSpec, value: string | number) => void;
  onPresetSelect: (model: string) => void;
  onSaveCustom: () => void;
}

export const PanelForm: React.FC<Props> = ({ panel, presets, onChange, onPresetSelect, onSaveCustom }) => {
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
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500">
            保存済みパネル項目
          </label>
          <div className="flex flex-col gap-3 md:flex-row">
            <select
              className="block w-full rounded-md border-0 bg-white py-2 px-3 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 transition-all duration-200 ease-in-out hover:ring-slate-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600"
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  onPresetSelect(e.target.value);
                }
              }}
            >
              <option value="">保存済み項目を選択して反映</option>
              {presets.map((preset) => (
                <option key={preset.model} value={preset.model}>
                  {preset.manufacturer} | {preset.model} ({preset.pmax}W)
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onSaveCustom}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
            >
              <Save size={16} />
              現在値を保存
            </button>
          </div>
          <p className="mt-2 text-[10px] leading-tight text-slate-500">
            メーカー・型式を含む現在の入力値をカスタム項目として保存します。
          </p>
        </div>

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
