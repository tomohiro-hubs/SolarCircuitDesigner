export type PanelSpec = {
  manufacturer: string;
  model: string;
  voc: number;        // 開放電圧 [V]
  vmp: number;        // 最大出力時電圧 [V]
  isc: number;        // 短絡電流 [A]
  imp: number;        // 最大出力時電流 [A]
  pmax: number;       // 定格出力 [W]
  tempCoeffVoc: number; // 温度係数(電圧) [%/°C] 例: -0.25
  tempCoeffIsc: number; // 温度係数(電流) [%/°C] 例: 0.04
  moduleCount: number;  // 総枚数
};

export type PcsSpec = {
  id: string;           // "PCS1" など内部ID
  manufacturer: string;
  model: string;
  ratedPower: number;   // 定格容量 [W]
  totalCircuits: number;
  mpptCount: number;    // MPPTの数
  startupVoltage: number;   // 起動電圧 [V]
  mpptMinVoltage: number;   // MPPT動作下限 [V]
  mpptMaxVoltage: number;   // MPPT動作上限 [V]
  maxInputVoltage: number;  // 最大入力電圧 [V]
  maxInputCurrentPerCircuit: number; // 最大入力電流(回路) [A]
  maxIscPerCircuit: number;          // 最大短絡電流(回路) [A]
  maxIscTotal: number;               // 最大短絡電流(PCS) [A]
  efficiency: number;   // 変換効率 [%]
};

export type SiteCondition = {
  minTemperature: number; // 想定最低温度 [°C]
  targetOverloadRatio: number; // 目標過積載率 [%] 例: 145
  manualSeriesCount?: number; // 直列数（指定なしの場合は自動計算）
};

export type StringDesign = {
  seriesModules: number;     // 1ストリング当たりの直列枚数
  vmpString: number;         // そのストリングの Vmp 合計
  vocStringCold: number;     // そのストリングの最低温度時 Voc 合計
};

export type CircuitAssignment = {
  pcsId: string;
  circuitIndex: number;       // 1〜totalCircuits
  mpptGroupIndex: number;     // 1〜mpptCount
  stringDesign: StringDesign | null; // ストリングがない場合はnull
  currentImp: number;         // 回路電流 (Imp)
  currentIsc: number;         // 回路短絡電流 (Isc)
};

export type DesignSummary = {
  pcsId: string;
  totalModulesAssigned: number;
  usedCircuits: number;
  overloadRatio: number;      // [%]
  warnings: string[];
  pvCapacityKw: number;       // kW
  pcsCapacityKw: number;      // kW
};

export type DesignResult = {
  assignments: CircuitAssignment[];
  summaries: DesignSummary[];
  totalOverloadRatio: number;
  totalPvCapacityKw: number;
  totalPcsCapacityKw: number;
  globalWarnings: string[];
};
