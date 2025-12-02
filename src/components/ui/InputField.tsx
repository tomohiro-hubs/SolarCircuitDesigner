import React from 'react';

interface InputFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  unit?: string;
  helperText?: string;
  error?: boolean;
}

export const InputField: React.FC<InputFieldProps> = ({ 
  label, 
  unit, 
  helperText, 
  className = '', 
  error,
  ...props 
}) => {
  return (
    <div className={`space-y-1 ${className}`}>
      <label className="block text-xs font-semibold text-slate-600 tracking-wide">
        {label}
      </label>
      <div className="relative rounded-md shadow-sm">
        <input
          {...props}
          className={`
            block w-full rounded-md border-0 py-1.5 px-3
            text-slate-900 ring-1 ring-inset 
            placeholder:text-slate-400 
            focus:ring-2 focus:ring-inset 
            transition-all duration-200 ease-in-out
            ${error 
              ? 'ring-red-300 focus:ring-red-500 bg-red-50' 
              : 'ring-slate-300 focus:ring-indigo-600 hover:ring-slate-400 bg-white'
            }
            ${unit ? 'pr-12' : ''}
            sm:text-sm sm:leading-6
          `}
        />
        {unit && (
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
            <span className="text-slate-400 sm:text-xs font-medium">{unit}</span>
          </div>
        )}
      </div>
      {helperText && (
        <p className="text-[10px] text-slate-500 leading-tight">{helperText}</p>
      )}
    </div>
  );
};
