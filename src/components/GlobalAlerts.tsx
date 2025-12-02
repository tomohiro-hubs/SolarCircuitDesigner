import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  warnings: string[];
}

export const GlobalAlerts: React.FC<Props> = ({ warnings }) => {
  if (warnings.length === 0) return null;

  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 animate-pulse mt-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="text-yellow-600 mt-0.5 flex-shrink-0" />
        <div className="space-y-1">
          <h4 className="text-sm font-bold text-yellow-800">注意が必要です</h4>
          {warnings.map((warn, idx) => (
            <p key={idx} className="text-sm text-yellow-700">{warn}</p>
          ))}
        </div>
      </div>
    </div>
  );
};
