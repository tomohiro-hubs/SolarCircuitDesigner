import React, { useRef } from 'react';
import { Download, FileSpreadsheet, FolderUp, Trash2 } from 'lucide-react';

interface Props {
  panelPresetNames: string[];
  pcsPresetNames: string[];
  message?: {
    type: 'success' | 'error';
    text: string;
  } | null;
  onExport: () => void;
  onImport: (file: File) => void;
  onImportExcel: (file: File) => void;
  onDeletePanelPreset: (model: string) => void;
  onDeletePcsPreset: (model: string) => void;
}

export const CustomPresetTransferPanel: React.FC<Props> = ({
  panelPresetNames,
  pcsPresetNames,
  message,
  onExport,
  onImport,
  onImportExcel,
  onDeletePanelPreset,
  onDeletePcsPreset,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const excelInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onImport(file);
    }
    event.target.value = '';
  };

  const handleExcelFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onImportExcel(file);
    }
    event.target.value = '';
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-sm font-bold text-slate-800">カスタム項目の入出力</h2>
          <p className="text-xs text-slate-500">
            保存済みのカスタムパネル・PCS項目を JSON でまとめてエクスポート/インポートします。
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onExport}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <Download size={16} />
            エクスポート
          </button>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
          >
            <FolderUp size={16} />
            JSON取込
          </button>
          <button
            type="button"
            onClick={() => excelInputRef.current?.click()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
          >
            <FileSpreadsheet size={16} />
            Excel反映
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleFileChange}
          />
          <input
            ref={excelInputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={handleExcelFileChange}
          />
        </div>
      </div>

      {message ? (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-xs ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-red-50 text-red-700'
          }`}
        >
          {message.text}
        </p>
      ) : null}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            保存済みパネル項目
          </h3>
          <div className="mt-3 space-y-2">
            {panelPresetNames.length > 0 ? (
              panelPresetNames.map((model) => (
                <div
                  key={model}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2"
                >
                  <span className="truncate pr-3 text-sm text-slate-700">{model}</span>
                  <button
                    type="button"
                    onClick={() => onDeletePanelPreset(model)}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50"
                  >
                    <Trash2 size={14} />
                    削除
                  </button>
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-500">保存済みのカスタムパネル項目はありません。</p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            保存済みPCS項目
          </h3>
          <div className="mt-3 space-y-2">
            {pcsPresetNames.length > 0 ? (
              pcsPresetNames.map((model) => (
                <div
                  key={model}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2"
                >
                  <span className="truncate pr-3 text-sm text-slate-700">{model}</span>
                  <button
                    type="button"
                    onClick={() => onDeletePcsPreset(model)}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50"
                  >
                    <Trash2 size={14} />
                    削除
                  </button>
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-500">保存済みのカスタムPCS項目はありません。</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
