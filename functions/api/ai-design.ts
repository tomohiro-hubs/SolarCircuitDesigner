import {
  computeDeterministicAiAssignments,
  convertAiAssignmentsToCircuitAssignments,
  summarizeAssignments,
  validateAiAssignments,
} from '../../src/logic/assignmentUtils';
import { AiDesignRequest, DesignResult } from '../../src/types';

interface Env {
  GEMINI_API_KEY: string;
  GEMINI_MODEL?: string;
}

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const REQUEST_TIMEOUT_MS = 60000;
const MAX_PCS_COUNT = 12;
const MAX_TOTAL_CIRCUITS = 256;

// 割付はサーバー側の決定アルゴリズムが行い、AIは「考察・注意点」の文章だけを担当する。
// Gemini の responseSchema は OpenAPI サブセット。additionalProperties は非対応なので付けない。
const commentarySchema = {
  type: 'object',
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

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // 別オリジン（GitHub Pages 等）のフロントから叩けるよう常にCORSを付与。
      'Access-Control-Allow-Origin': '*',
      ...(init?.headers ?? {}),
    },
  });
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateRequestShape(body: any): body is AiDesignRequest {
  if (!body || typeof body !== 'object') {
    return false;
  }

  if (!body.panel || !body.condition || !Array.isArray(body.pcsList) || !body.baselineResult) {
    return false;
  }

  if (body.pcsList.length === 0 || body.pcsList.length > MAX_PCS_COUNT) {
    return false;
  }

  const totalCircuits = body.pcsList.reduce(
    (sum: number, pcs: any) => sum + (typeof pcs?.totalCircuits === 'number' ? pcs.totalCircuits : 0),
    0
  );

  if (totalCircuits <= 0 || totalCircuits > MAX_TOTAL_CIRCUITS) {
    return false;
  }

  const panel = body.panel;
  const condition = body.condition;
  const panelNumbers = [
    panel.voc,
    panel.vmp,
    panel.isc,
    panel.imp,
    panel.pmax,
    panel.tempCoeffVoc,
    panel.tempCoeffIsc,
    panel.moduleCount,
    condition.minTemperature,
    condition.targetOverloadRatio,
  ];

  if (!panelNumbers.every(isFiniteNumber)) {
    return false;
  }

  return body.pcsList.every((pcs: any) =>
    pcs &&
    typeof pcs.id === 'string' &&
    [
      pcs.ratedPower,
      pcs.totalCircuits,
      pcs.mpptCount,
      pcs.startupVoltage,
      pcs.mpptMinVoltage,
      pcs.mpptMaxVoltage,
      pcs.maxInputVoltage,
      pcs.maxInputCurrentPerCircuit,
      pcs.maxIscPerCircuit,
      pcs.maxIscTotal,
    ].every(isFiniteNumber)
  );
}

function extractOutputText(responsePayload: any): string | null {
  // 念のため、すでにパース済みの構造が返ってきた場合にも対応。
  if (
    responsePayload &&
    typeof responsePayload === 'object' &&
    typeof responsePayload.summary === 'string' &&
    Array.isArray(responsePayload.reasoning) &&
    Array.isArray(responsePayload.warnings) &&
    Array.isArray(responsePayload.assignments)
  ) {
    return JSON.stringify(responsePayload);
  }

  // Gemini generateContent の正規レスポンス: candidates[0].content.parts[].text
  const candidates = Array.isArray(responsePayload?.candidates) ? responsePayload.candidates : [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    const text = parts
      .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim();
    if (text) {
      return text;
    }
  }

  return null;
}

type Commentary = { summary: string; reasoning: string[]; warnings: string[] };

// 決定アルゴリズムの割付結果(DesignResult)から、AIに渡す/フォールバックに使う統計テキストを作る。
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

// 決定的な考察文（AIが使えない場合のフォールバック）
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

// AIに考察文だけ生成させる。失敗時は null（呼び出し側でフォールバック）。
async function requestGeminiCommentary(
  body: AiDesignRequest,
  result: DesignResult,
  remainingModules: number,
  env: Env
): Promise<Commentary | null> {
  if (!env.GEMINI_API_KEY) {
    return null;
  }

  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': env.GEMINI_API_KEY,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: buildCommentaryPrompt(body, result, remainingModules) }],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: commentarySchema,
            temperature: 0.2,
            topP: 1,
            maxOutputTokens: 2048,
          },
        }),
      }
    );

    const responsePayload = await response.json();
    if (!response.ok) {
      return null;
    }
    if (responsePayload?.promptFeedback?.blockReason) {
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

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: unknown;

  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'JSON の読み取りに失敗しました。' }, { status: 400 });
  }

  if (!validateRequestShape(body)) {
    return json({ error: '入力データが不正です。' }, { status: 400 });
  }

  try {
    // 1. 割付は決定アルゴリズムで確定（全パネル配置・制約遵守）
    const assignments = computeDeterministicAiAssignments(body.panel, body.pcsList, body.condition);

    // 2. 念のため制約検証（アルゴリズムが正しければ空）
    const validationErrors = validateAiAssignments(
      body.panel,
      body.pcsList,
      body.condition,
      assignments
    );
    if (validationErrors.length > 0) {
      return json(
        { error: '割付結果が制約を満たしませんでした。', details: validationErrors },
        { status: 422, headers: { 'Access-Control-Allow-Origin': '*' } }
      );
    }

    // 3. 割付結果を集計し、残枚数を算出
    const circuitAssignments = convertAiAssignmentsToCircuitAssignments(
      body.panel,
      body.pcsList,
      body.condition,
      assignments
    );
    const result = summarizeAssignments(body.panel, body.pcsList, body.condition, circuitAssignments);
    const placed = assignments.reduce((sum, a) => sum + a.seriesModules, 0);
    const remainingModules = body.panel.moduleCount - placed;

    // 4. 考察文はAIに依頼（失敗時は決定的テキストにフォールバック）
    const commentary =
      (await requestGeminiCommentary(body, result, remainingModules, context.env)) ??
      deterministicCommentary(body, result, remainingModules);

    return json(
      {
        suggestion: { ...commentary, assignments },
        model: context.env.GEMINI_MODEL || DEFAULT_MODEL,
      },
      {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return json(
        { error: `Gemini API が ${REQUEST_TIMEOUT_MS / 1000} 秒以内に応答しませんでした。タイムアウトしました。` },
        {
          status: 504,
          headers: {
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    const message =
      error instanceof Error ? error.message : 'AI自動設計の処理に失敗しました。';
    return json(
      { error: message },
      {
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
};
