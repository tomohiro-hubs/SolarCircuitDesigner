import { validateAiAssignments } from '../../src/logic/assignmentUtils';
import { calculateAllowedSeriesRange, calculateVocCold } from '../../src/logic/stringDesign';
import { AiAssignment, AiDesignRequest } from '../../src/types';

interface Env {
  GEMINI_API_KEY: string;
  GEMINI_MODEL?: string;
}

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-2.5-flash';
const REQUEST_TIMEOUT_MS = 60000;
const MAX_PCS_COUNT = 12;
const MAX_TOTAL_CIRCUITS = 256;

// Gemini の responseSchema は OpenAPI サブセット。additionalProperties は非対応なので付けない。
const suggestionSchema = {
  type: 'object',
  required: ['summary', 'reasoning', 'warnings', 'assignments'],
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
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        required: ['pcsId', 'circuitIndex', 'seriesModules'],
        properties: {
          pcsId: { type: 'string' },
          circuitIndex: { type: 'integer' },
          seriesModules: { type: 'integer' },
        },
      },
    },
  },
} as const;

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
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

function parseAssignments(rawAssignments: unknown): AiAssignment[] {
  if (!Array.isArray(rawAssignments)) {
    throw new Error('AIの割付データが不正です。');
  }

  return rawAssignments.map((assignment) => {
    if (!assignment || typeof assignment !== 'object') {
      throw new Error('AIの割付データが不正です。');
    }

    const candidate = assignment as Record<string, unknown>;
    if (
      typeof candidate.pcsId !== 'string' ||
      !Number.isInteger(candidate.circuitIndex) ||
      !Number.isInteger(candidate.seriesModules)
    ) {
      throw new Error('AIの割付データが不正です。');
    }

    return {
      pcsId: candidate.pcsId,
      circuitIndex: candidate.circuitIndex as number,
      seriesModules: candidate.seriesModules as number,
    };
  });
}

function buildPromptText(body: AiDesignRequest): string {
  const { panel, pcsList, condition } = body;
  const vocCold = calculateVocCold(panel, condition.minTemperature);

  // 各PCSの「使える回路番号」と「許容直列数」を明示し、
  // 割付表にそのまま入る形（pcsId・circuitIndex・seriesModules）で返させる。
  const pcsGuides = pcsList
    .map((pcs) => {
      const range = calculateAllowedSeriesRange(panel, pcs, vocCold);
      const rangeText = range.error
        ? `設計不可（${range.error}）`
        : `直列数は ${range.min}〜${range.max} 枚の整数`;
      return `- pcsId="${pcs.id}": circuitIndex は 1〜${pcs.totalCircuits} の整数。${rangeText}。定格 ${pcs.ratedPower}W、MPPT数 ${pcs.mpptCount}。`;
    })
    .join('\n');

  return [
    'あなたは太陽光発電所の回路設計を支援するエンジニアです。',
    '目的: 各PCSの回路ごとに「直列モジュール数(seriesModules)」を決め、割付表を埋めること。',
    '必ず安全側で判断し、既存の制約違反を起こさない割付だけを提案してください。',
    'ベースライン結果を踏まえ、PCS間の配分・余りの扱い・過積載率のバランスを改善してください。',
    '',
    '【割付ルール（厳守）】',
    `1. pcsId は次のいずれかを正確に使用する（新しいidを作らない）:\n${pcsGuides}`,
    '2. circuitIndex は各PCSで 1 から始まる整数。範囲外や重複は禁止。',
    '3. 各 seriesModules は上記の許容直列数の範囲内の整数にする。【禁則】1〜2枚の直列構成は禁止（使う回路は必ず3枚以上）。適切な電圧設計を維持するため、余り枚数の数合わせのために「1回路1枚」のような構成にしてはならない（許容範囲内に収められないなら、その回路は使わず空ける）。',
    '4. MPPTは「2回路で1組」として扱う（circuitIndex の (1,2)(3,4)(5,6)… が同一MPPT）。同一MPPTに2回路とも入れる場合、その2回路の seriesModules は必ず同じ枚数にする。片側1回路だけ使う場合はこの制約は適用しない。',
    `5. 目標過積載率は ${condition.targetOverloadRatio}%（概ね145%前後を目安）。各PCSでこの値にできるだけ近づけ、下回りすぎ・上回りすぎを避ける。`,
    `6. パネル総数 ${panel.moduleCount} 枚を超えて割り当てない。余りが出ても電圧設計を崩す数合わせはしない。`,
    '7. 選択されている各PCSの仕様（MPPT電圧範囲・最大入力電圧・回路/合計の電流制限など）にマッチした回路設計にする。',
    '8. 使わない回路は assignments に含めなくてよい（含める場合は seriesModules を 0 にする）。',
    '',
    '返答は指定された JSON Schema に厳密準拠した JSON のみを返してください。',
    '',
    '【設計入力データ】',
    JSON.stringify(body),
  ].join('\n');
}

async function requestGeminiSuggestion(body: AiDesignRequest, env: Env) {
  if (!env.GEMINI_API_KEY) {
    throw new Error('Cloudflare secret GEMINI_API_KEY が設定されていません。');
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
              parts: [{ text: buildPromptText(body) }],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: suggestionSchema,
          },
        }),
      }
    );

    const responsePayload = await response.json();
    if (!response.ok) {
      const message =
        responsePayload?.error?.message ||
        responsePayload?.message ||
        'Gemini API の呼び出しに失敗しました。';
      throw new Error(message);
    }

    // 安全性フィルタ等でブロックされた場合は candidates が空になる。
    const blockReason = responsePayload?.promptFeedback?.blockReason;
    if (blockReason) {
      throw new Error(`Gemini がリクエストをブロックしました（理由: ${blockReason}）。`);
    }

    const outputText = extractOutputText(responsePayload);
    if (!outputText) {
      throw new Error('AIの応答を解釈できませんでした。');
    }

    const parsed = JSON.parse(outputText);
    return {
      suggestion: {
        summary: parsed.summary,
        reasoning: Array.isArray(parsed.reasoning) ? parsed.reasoning : [],
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
        assignments: parseAssignments(parsed.assignments),
      },
      model: responsePayload?.modelVersion || model,
    };
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
    const aiResponse = await requestGeminiSuggestion(body, context.env);
    const validationErrors = validateAiAssignments(
      body.panel,
      body.pcsList,
      body.condition,
      aiResponse.suggestion.assignments
    );

    if (validationErrors.length > 0) {
      return json(
        {
          error: 'AI提案が制約を満たしませんでした。',
          details: validationErrors,
        },
        {
          status: 422,
          headers: {
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    return json(aiResponse, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    });
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
