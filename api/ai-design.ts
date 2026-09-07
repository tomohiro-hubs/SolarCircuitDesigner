import {
  computeDeterministicAiAssignments,
  convertAiAssignmentsToCircuitAssignments,
  diagnoseUnusablePcs,
  summarizeAssignments,
  validateAiAssignments,
} from '../src/logic/assignmentUtils';
import { AiDesignRequest, DesignResult } from '../src/types';

// OpenAI Responses API（構造化出力は text.format の json_schema を使う）
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
const REQUEST_TIMEOUT_MS = 60000;
const MAX_PCS_COUNT = 50;
const MAX_TOTAL_CIRCUITS = 1024;

// 割付はサーバー側の決定アルゴリズムが行い、AIは「考察・注意点」の文章だけを担当する。
// OpenAI の strict な json_schema は additionalProperties: false と全プロパティの required が必須。
const commentarySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'reasoning', 'warnings'],
  properties: {
    summary: { type: 'string' },
    reasoning: {
      type: 'array',
      items: { type: 'string' },
    },
    warnings: {
      type: 'array',
      items: { type: 'string' },
    },
  },
} as const;

function setCors(res: any) {
  // 別オリジン（GitHub Pages 等）のフロントから叩けるようCORSを付与。
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res: any, status: number, body: unknown) {
  setCors(res);
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(body));
}

// 数値 or 数値文字列("200"など)を number に変換。空・非数は NaN。
function coerceNum(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

const PANEL_LABELS: Record<string, string> = {
  voc: 'パネル Voc(開放電圧)',
  vmp: 'パネル Vmp(動作電圧)',
  isc: 'パネル Isc(短絡電流)',
  imp: 'パネル Imp(動作電流)',
  pmax: 'パネル Pmax(定格出力)',
  tempCoeffVoc: 'パネル 温度係数(Voc)',
  moduleCount: 'パネル総数',
};
const CONDITION_LABELS: Record<string, string> = {
  minTemperature: '想定最低気温',
  targetOverloadRatio: '目標過積載率',
};
const PCS_LABELS: Record<string, string> = {
  ratedPower: '定格出力',
  totalCircuits: '回路数',
  mpptCount: 'MPPT数',
  startupVoltage: '起動電圧',
  mpptMinVoltage: 'MPPT下限電圧',
  mpptMaxVoltage: 'MPPT上限電圧',
  maxInputVoltage: '最大入力電圧',
  maxInputCurrentPerCircuit: '最大入力電流/回路',
  maxIscPerCircuit: '最大短絡電流/回路',
  maxIscTotal: '最大短絡電流/PCS合計',
};

// 入力を検証しつつ数値へ正規化する。問題があれば「どの項目が原因か」を示すメッセージを返す（正常なら null）。
function validateAndNormalize(body: any): string | null {
  if (!body || typeof body !== 'object') return '入力データがありません。';
  if (!body.panel || !body.condition || !Array.isArray(body.pcsList) || !body.baselineResult) {
    return 'パネル・設置条件・PCS・ベースライン結果のいずれかが不足しています。';
  }
  if (body.pcsList.length === 0 || body.pcsList.length > MAX_PCS_COUNT) {
    return `PCSの台数が不正です（1〜${MAX_PCS_COUNT}台）。`;
  }

  const panel = body.panel;
  const condition = body.condition;

  for (const key of Object.keys(PANEL_LABELS)) {
    const n = coerceNum(panel[key]);
    if (!Number.isFinite(n)) return `${PANEL_LABELS[key]} の値を入力してください。`;
    panel[key] = n;
  }
  // tempCoeffIsc はサーバーの割付計算では未使用。未入力なら 0 とみなす。
  panel.tempCoeffIsc = Number.isFinite(coerceNum(panel.tempCoeffIsc)) ? coerceNum(panel.tempCoeffIsc) : 0;

  for (const key of Object.keys(CONDITION_LABELS)) {
    const n = coerceNum(condition[key]);
    if (!Number.isFinite(n)) return `${CONDITION_LABELS[key]} の値を入力してください。`;
    condition[key] = n;
  }

  let totalCircuits = 0;
  for (const pcs of body.pcsList) {
    if (!pcs || typeof pcs.id !== 'string') return 'PCSのIDが不正です。';
    for (const key of Object.keys(PCS_LABELS)) {
      const n = coerceNum(pcs[key]);
      if (!Number.isFinite(n)) return `${pcs.id} の「${PCS_LABELS[key]}」を入力してください。`;
      if ((key === 'maxIscTotal' || key === 'totalCircuits' || key === 'ratedPower') && n <= 0) {
        return `${pcs.id} の「${PCS_LABELS[key]}」は0より大きい値を入力してください。`;
      }
      pcs[key] = n;
    }
    totalCircuits += pcs.totalCircuits;
  }

  if (totalCircuits <= 0 || totalCircuits > MAX_TOTAL_CIRCUITS) {
    return `回路数の合計が不正です（1〜${MAX_TOTAL_CIRCUITS}）。`;
  }

  return null;
}

// Responses API の出力: output[] の中の message アイテム -> content[].output_text
function extractOutputText(responsePayload: any): string | null {
  if (typeof responsePayload?.output_text === 'string' && responsePayload.output_text.trim()) {
    return responsePayload.output_text.trim();
  }

  const output = Array.isArray(responsePayload?.output) ? responsePayload.output : [];
  for (const item of output) {
    // reasoning など message 以外のアイテムは読み飛ばす。
    if (item?.type && item.type !== 'message') continue;
    const contents = Array.isArray(item?.content) ? item.content : [];
    const text = contents
      .map((part: any) => (part?.type === 'output_text' && typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim();
    if (text) {
      return text;
    }
  }

  return null;
}

type Commentary = { summary: string; reasoning: string[]; warnings: string[] };

function buildDesignFacts(
  body: AiDesignRequest,
  result: DesignResult,
  remainingModules: number
): string {
  const { panel, condition } = body;
  const lines = result.summaries.map(
    (s) =>
      `- ${s.pcsId}: 使用回路${s.usedCircuits} / 割当${s.totalModulesAssigned}枚 / PV ${s.pvCapacityKw.toFixed(1)}kW / 過積載率 ${s.overloadRatio.toFixed(1)}%`
  );
  return [
    `総パネル ${panel.moduleCount}枚 / 目標過積載率 ${condition.targetOverloadRatio}% / 最低温度 ${condition.minTemperature}℃`,
    `全体: PV ${result.totalPvCapacityKw.toFixed(1)}kW / PCS ${result.totalPcsCapacityKw.toFixed(1)}kW / 総過積載率 ${result.totalOverloadRatio.toFixed(1)}%`,
    `未配置(残)パネル: ${remainingModules}枚`,
    'PCSごと:',
    ...lines,
  ].join('\n');
}

function deterministicCommentary(
  body: AiDesignRequest,
  result: DesignResult,
  remainingModules: number
): Commentary {
  const { condition } = body;
  const summary =
    `全${body.panel.moduleCount}枚中 ${body.panel.moduleCount - remainingModules}枚を割り付けました` +
    `（総過積載率 ${result.totalOverloadRatio.toFixed(1)}%、目標 ${condition.targetOverloadRatio}%）。` +
    (remainingModules > 0 ? ` 制約上どうしても入らない ${remainingModules}枚が残っています。` : ' 全パネルを配置できました。');

  const reasoning = [
    'MPPTは2回路1組として、両回路を使う組は直列数を揃えています。',
    '各回路の直列数は電圧・電流制約の許容範囲内に収め、1〜2枚の極小構成は作っていません。',
    `過積載率が目標(${condition.targetOverloadRatio}%)に近づくよう、定格容量に応じてPCS間へ配分しています。`,
  ];

  const warnings = [...result.globalWarnings];
  result.summaries.forEach((s) => warnings.push(...s.warnings));

  return { summary, reasoning, warnings: Array.from(new Set(warnings)) };
}

function buildCommentaryPrompt(
  body: AiDesignRequest,
  result: DesignResult,
  remainingModules: number
): string {
  return [
    'あなたは太陽光発電所の回路設計をレビューするエンジニアです。',
    '以下は「決定的アルゴリズムが確定させた回路割付の結果」です。割付は既に確定しており、変更しません。',
    'この結果に対する日本語の「考察(reasoning)」と「注意点(warnings)」、および一文の「結論(summary)」だけを述べてください。',
    '数値や割付そのものを作り直さず、与えられた事実に基づいて簡潔に説明・評価してください。',
    '',
    '【確定した設計の事実】',
    buildDesignFacts(body, result, remainingModules),
    '',
    '返答は指定された JSON Schema（summary, reasoning, warnings）に厳密準拠した JSON のみ。',
  ].join('\n');
}

async function requestCommentary(
  body: AiDesignRequest,
  result: DesignResult,
  remainingModules: number
): Promise<Commentary | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: buildCommentaryPrompt(body, result, remainingModules) }],
          },
        ],
        // gpt-5.6系は temperature 非対応。深さは reasoning.effort で制御する。
        reasoning: { effort: 'low' },
        text: {
          format: {
            type: 'json_schema',
            name: 'design_commentary',
            strict: true,
            schema: commentarySchema,
          },
        },
        // reasoning トークンも max_output_tokens に含まれるため余裕を持たせる。
        max_output_tokens: 4096,
      }),
    });

    const responsePayload = await response.json();
    if (!response.ok || responsePayload?.status === 'incomplete') {
      return null;
    }

    const outputText = extractOutputText(responsePayload);
    if (!outputText) {
      return null;
    }

    const parsed = JSON.parse(outputText);
    if (typeof parsed?.summary !== 'string') {
      return null;
    }
    return {
      summary: parsed.summary,
      reasoning: Array.isArray(parsed.reasoning) ? parsed.reasoning : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    setCors(res);
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  const body =
    typeof req.body === 'string'
      ? (() => {
          try {
            return JSON.parse(req.body);
          } catch {
            return null;
          }
        })()
      : req.body;

  const validationError = validateAndNormalize(body);
  if (validationError) {
    return json(res, 400, { error: validationError });
  }

  // 電圧の狙い（再検討ボタン用）: 'high' | 'normal' | 'low'。既定は 'normal'。
  const voltagePreference: 'high' | 'normal' | 'low' =
    body.voltagePreference === 'high' || body.voltagePreference === 'low'
      ? body.voltagePreference
      : 'normal';

  try {
    // 1. 割付は決定アルゴリズムで確定（全パネル配置・制約遵守）
    const assignments = computeDeterministicAiAssignments(
      body.panel,
      body.pcsList,
      body.condition,
      voltagePreference
    );

    // 1b. 1枚も割り付けられない場合は理由を明示して返す
    if (assignments.length === 0) {
      const reasons = diagnoseUnusablePcs(body.panel, body.pcsList, body.condition);
      return json(res, 422, {
        error: 'この構成では有効な回路割付ができませんでした。パネルとPCSの仕様（電流・電圧の上限）をご確認ください。',
        details: reasons.length > 0 ? reasons : ['すべてのPCSで割付可能な回路がありませんでした。'],
      });
    }

    // 2. 念のため制約検証
    const validationErrors = validateAiAssignments(
      body.panel,
      body.pcsList,
      body.condition,
      assignments
    );
    if (validationErrors.length > 0) {
      return json(res, 422, {
        error: '割付結果が制約を満たしませんでした。',
        details: validationErrors,
      });
    }

    // 3. 集計と残枚数
    const circuitAssignments = convertAiAssignmentsToCircuitAssignments(
      body.panel,
      body.pcsList,
      body.condition,
      assignments
    );
    const result = summarizeAssignments(body.panel, body.pcsList, body.condition, circuitAssignments);
    const placed = assignments.reduce((sum, a) => sum + a.seriesModules, 0);
    const remainingModules = body.panel.moduleCount - placed;

    // 4. 考察文はAI（失敗時は決定的テキストにフォールバック）
    const commentary =
      (await requestCommentary(body, result, remainingModules)) ??
      deterministicCommentary(body, result, remainingModules);

    return json(res, 200, {
      suggestion: { ...commentary, assignments },
      model: DEFAULT_MODEL,
      voltagePreference,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return json(res, 504, {
        error: `OpenAI API が ${REQUEST_TIMEOUT_MS / 1000} 秒以内に応答しませんでした。タイムアウトしました。`,
      });
    }

    const message =
      error instanceof Error ? error.message : 'AI自動設計の処理に失敗しました。';
    return json(res, 500, { error: message });
  }
}
