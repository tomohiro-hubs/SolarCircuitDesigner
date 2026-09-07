import React from 'react';
import { PcsPreset, PcsSpec } from '../types';
import { Zap, Plus, Trash2, Settings2, Save } from 'lucide-react';
import { InputField } from './ui/InputField';

interface Props {
  pcsList: PcsSpec[];
  presets: PcsPreset[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, field: keyof PcsSpec, value: string | number | boolean) => void;
  onPresetSelect: (id: string, model: string) => void;
  onSaveCustom: (id: string) => void;
}

export const PcsListForm: React.FC<Props> = ({
  pcsList,
  presets,
  onAdd,
  onRemove,
  onChange,
  onPresetSelect,
  onSaveCustom,
}) => {
  const handleChange = (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type } = e.target;
    const val = type === 'number' ? parseFloat(value) : value;
    onChange(id, name as keyof PcsSpec, val);
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 px-1">
          <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
            <Zap size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800">PCS構成</h2>
            <p className="text-xs text-slate-500">パワーコンディショナの仕様と台数</p>
          </div>
        </div>
        <button
          onClick={onAdd}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 shadow-md hover:shadow-lg transition-all active:scale-95"
        >
          <Plus size={16} />
          PCS追加
        </button>
      </div>

      <div className="space-y-4">
        {pcsList.map((pcs, index) => (
          <div key={pcs.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden transition-all hover:shadow-md">
            {/* PCS Header */}
            <div className="bg-slate-50 px-6 py-3 border-b border-slate-100 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <span className="bg-slate-200 text-slate-600 text-xs font-bold px-2 py-1 rounded">#{index + 1}</span>
                <span className="font-bold text-slate-700">{pcs.id}</span>
              </div>
              {pcsList.length > 1 && (
                <button
                  onClick={() => onRemove(pcs.id)}
                  className="text-slate-400 hover:text-red-500 hover:bg-red-50 p-1.5 rounded transition-colors"
                  title="このPCSを削除"
                >
                  <Trash2 size={18} />
                </button>
              )}
            </div>

            <div className="p-6">
              <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  保存済みPCS項目
                </label>
                <div className="flex flex-col gap-3 md:flex-row">
                  <select
                    className="block w-full rounded-md border-0 bg-white py-2 px-3 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 transition-all duration-200 ease-in-out hover:ring-slate-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        onPresetSelect(pcs.id, e.target.value);
                      }
                    }}
                  >
                    <option value="">保存済み項目を選択して反映</option>
                    {presets.map((preset) => (
                      <option key={preset.model} value={preset.model}>
                        {preset.manufacturer} | {preset.model} ({(preset.ratedPower / 1000).toFixed(2)}kW)
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => onSaveCustom(pcs.id)}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
                  >
                    <Save size={16} />
                    現在値を保存
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-6">
                
                {/* Left Column: 基本スペック */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Settings2 size={16} className="text-indigo-500" />
                    <h3 className="text-xs font-bold text-indigo-900 uppercase tracking-wider">基本仕様</h3>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <InputField
                      label="メーカー"
                      name="manufacturer"
                      value={pcs.manufacturer}
                      onChange={(e) => handleChange(pcs.id, e)}
                      placeholder="メーカー"
                    />
                    <InputField
                      label="型式"
                      name="model"
                      value={pcs.model}
                      onChange={(e) => handleChange(pcs.id, e)}
                      placeholder="型式"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <InputField
                      label="定格容量"
                      name="ratedPower"
                      type="number"
                      unit="W"
                      value={pcs.ratedPower || ''}
                      onChange={(e) => handleChange(pcs.id, e)}
                    />
                    <InputField
                      label="変換効率"
                      name="efficiency"
                      type="number"
                      unit="%"
                      value={pcs.efficiency || ''}
                      onChange={(e) => handleChange(pcs.id, e)}
                    />
                    <InputField
                      label="定格入力電圧"
                      name="ratedInputVoltage"
                      type="number"
                      unit="V"
                      value={pcs.ratedInputVoltage || ''}
                      onChange={(e) => handleChange(pcs.id, e)}
                    />
                    <InputField
                      label="総回路数"
                      name="totalCircuits"
                      type="number"
                      unit="回路"
                      value={pcs.totalCircuits || ''}
                      onChange={(e) => handleChange(pcs.id, e)}
                    />
                    <InputField
                      label="MPPT数"
                      name="mpptCount"
                      type="number"
                      value={pcs.mpptCount || ''}
                      onChange={(e) => handleChange(pcs.id, e)}
                    />
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!pcs.manualCircuitEnabled}
                        onChange={(e) => onChange(pcs.id, 'manualCircuitEnabled', e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
                      />
                      回路構成を手動指定
                    </label>
                    {pcs.manualCircuitEnabled && (
                      <div className="grid grid-cols-2 gap-3">
                        <InputField
                          label="直列数"
                          name="manualSeriesModules"
                          type="number"
                          unit="枚"
                          value={pcs.manualSeriesModules || ''}
                          onChange={(e) => handleChange(pcs.id, e)}
                        />
                        <InputField
                          label="並列数"
                          name="manualParallelCount"
                          type="number"
                          unit="回路"
                          value={pcs.manualParallelCount || ''}
                          onChange={(e) => handleChange(pcs.id, e)}
                          helperText="並列数=回路数として扱います（各回路が直列数の枚数で構成されます）"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Column: 電圧・電流制限 */}
                <div className="space-y-4">
                   <div className="flex items-center gap-2 mb-2">
                    <Settings2 size={16} className="text-indigo-500" />
                    <h3 className="text-xs font-bold text-indigo-900 uppercase tracking-wider">制約条件 (電圧・電流)</h3>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <InputField
                      label="起動電圧"
                      name="startupVoltage"
                      type="number"
                      unit="V"
                      value={pcs.startupVoltage || ''}
                      onChange={(e) => handleChange(pcs.id, e)}
                    />
                    <InputField
                      label="MPPT下限"
                      name="mpptMinVoltage"
                      type="number"
                      unit="V"
                      value={pcs.mpptMinVoltage || ''}
                      onChange={(e) => handleChange(pcs.id, e)}
                    />
                    <InputField
                      label="MPPT上限"
                      name="mpptMaxVoltage"
                      type="number"
                      unit="V"
                      value={pcs.mpptMaxVoltage || ''}
                      onChange={(e) => handleChange(pcs.id, e)}
                    />
                  </div>

                   <div className="grid grid-cols-2 gap-3">
                    <InputField
                      label="最大入力電圧"
                      name="maxInputVoltage"
                      type="number"
                      unit="V"
                      value={pcs.maxInputVoltage || ''}
                      onChange={(e) => handleChange(pcs.id, e)}
                    />
                    <InputField
                      label="最大回路電流"
                      name="maxInputCurrentPerCircuit"
                      type="number"
                      unit="A"
                      value={pcs.maxInputCurrentPerCircuit || ''}
                      onChange={(e) => handleChange(pcs.id, e)}
                      helperText="Imp制限値"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                     <InputField
                      label="最大回路短絡電流"
                      name="maxIscPerCircuit"
                      type="number"
                      unit="A"
                      value={pcs.maxIscPerCircuit || ''}
                      onChange={(e) => handleChange(pcs.id, e)}
                      helperText="Isc制限値"
                    />
                     <InputField
                      label="PCS最大短絡電流"
                      name="maxIscTotal"
                      type="number"
                      unit="A"
                      value={pcs.maxIscTotal || ''}
                      onChange={(e) => handleChange(pcs.id, e)}
                      helperText="合計Isc制限値"
                    />
                  </div>
                </div>

              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
