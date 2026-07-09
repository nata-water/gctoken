import type { ModelUsage, ParsedSession } from "./types.js";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}

function normalizeModelId(model: unknown, fallback = "gpt-4o"): string {
  if (typeof model !== "string") {
    return fallback;
  }
  const trimmed = model.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.startsWith("copilot/")
    ? trimmed.slice("copilot/".length)
    : trimmed;
}

function normalizeDisplayModelName(model: string): string {
  return model.trim().toLowerCase().replace(/\s+/g, "-");
}

function extractResultDetails(result: unknown): {
  model: string | undefined;
  aiCredits: number;
} {
  if (!isObject(result) || typeof result.details !== "string") {
    return { model: undefined, aiCredits: 0 };
  }

  const details = result.details.trim();
  const creditMatch = details.match(/([\d.]+)\s+credits?\b/i);
  const modelPart = details.split("•")[0]?.trim() ?? "";

  return {
    model: modelPart ? normalizeDisplayModelName(modelPart) : undefined,
    aiCredits: creditMatch ? Number(creditMatch[1]) : 0,
  };
}

function getNestedObject(value: unknown, key: string): JsonObject | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  const nested = value[key];
  return isObject(nested) ? nested : undefined;
}

function extractUsage(
  value: unknown,
):
  | {
      inputTokens: number;
      outputTokens: number;
      thinkingTokens: number;
      cachedInputTokens: number;
      cacheWriteTokens: number;
    }
  | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const metadata = isObject(record.metadata) ? record.metadata : undefined;
  const usage = isObject(record.usage) ? record.usage : undefined;
  const candidates = [usage, metadata, record].filter(isObject);

  for (const candidate of candidates) {
    const inputTokens =
      getNumber(candidate.promptTokens) ??
      getNumber(candidate.inputTokens) ??
      getNumber(candidate.prompt_tokens) ??
      getNumber(candidate.input_tokens) ??
      0;
    const outputBase =
      getNumber(candidate.outputTokens) ??
      getNumber(candidate.completionTokens) ??
      getNumber(candidate.output_tokens) ??
      getNumber(candidate.completion_tokens) ??
      0;
    const thinkingTokens =
      getNumber(candidate.reasoningTokens) ??
      getNumber(candidate.thinkingTokens) ??
      getNumber(candidate.reasoning_tokens) ??
      getNumber(candidate.thinking_tokens) ??
      0;
    const cachedInputTokens =
      getNumber(candidate.cachedInputTokens) ??
      getNumber(candidate.cacheReadInputTokens) ??
      getNumber(candidate.cache_read_input_tokens) ??
      getNumber(candidate.cached_input_tokens) ??
      0;
    const cacheWriteTokens =
      getNumber(candidate.cacheWriteTokens) ??
      getNumber(candidate.cacheCreationInputTokens) ??
      getNumber(candidate.cache_creation_input_tokens) ??
      getNumber(candidate.cache_write_input_tokens) ??
      0;

    if (
      inputTokens > 0 ||
      outputBase > 0 ||
      thinkingTokens > 0 ||
      cachedInputTokens > 0 ||
      cacheWriteTokens > 0
    ) {
      return {
        inputTokens,
        outputTokens: outputBase + thinkingTokens,
        thinkingTokens,
        cachedInputTokens,
        cacheWriteTokens,
      };
    }
  }

  return undefined;
}
function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function extractResponseText(response: unknown): {
  text: string;
  thinkingText: string;
} {
  if (typeof response === "string") {
    return { text: response, thinkingText: "" };
  }

  if (!Array.isArray(response)) {
    return { text: "", thinkingText: "" };
  }

  let text = "";
  let thinkingText = "";
  for (const item of response) {
    if (!isObject(item)) {
      continue;
    }

    if (item.kind === "thinking") {
      if (typeof item.value === "string") {
        thinkingText += item.value;
      }
      continue;
    }

    const content = isObject(item.content) ? item.content.value : undefined;
    if (typeof content === "string") {
      text += content;
      continue;
    }
    if (typeof item.value === "string") {
      text += item.value;
    }
  }

  return { text, thinkingText };
}

function extractMessageText(message: unknown): string {
  if (typeof message === "string") {
    return message;
  }
  if (!isObject(message)) {
    return "";
  }
  if (typeof message.text === "string") {
    return message.text;
  }
  if (!Array.isArray(message.parts)) {
    return "";
  }
  return message.parts
    .map((part) =>
      isObject(part) && typeof part.text === "string" ? part.text : "",
    )
    .join("");
}

function stringifyStreamingText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (!isObject(value)) {
    return "";
  }
  return Object.entries(value)
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([, item]) => (typeof item === "string" ? item : ""))
    .join("");
}

function extractSubAgentText(item: unknown): {
  prompt: string;
  result: string;
  model: string | undefined;
} | undefined {
  if (!isObject(item) || item.kind !== "toolInvocationSerialized") {
    return undefined;
  }

  const toolSpecificData = getNestedObject(item, "toolSpecificData");
  if (!toolSpecificData || toolSpecificData.kind !== "subagent") {
    return undefined;
  }

  const prompt =
    typeof toolSpecificData.prompt === "string" ? toolSpecificData.prompt : "";
  const result = stringifyStreamingText(toolSpecificData.result);
  const model =
    typeof toolSpecificData.modelName === "string"
      ? toolSpecificData.modelName.trim().toLowerCase().replace(/\s+/g, "-")
      : undefined;

  if (!prompt && !result) {
    return undefined;
  }

  return { prompt, result, model };
}

function addModelUsage(
  modelUsage: ModelUsage,
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens = 0,
  cacheWriteTokens = 0,
): void {
  if (!modelUsage[model]) {
    modelUsage[model] = { inputTokens: 0, outputTokens: 0 };
  }
  modelUsage[model].inputTokens += inputTokens;
  modelUsage[model].outputTokens += outputTokens;
  modelUsage[model].cachedInputTokens =
    (modelUsage[model].cachedInputTokens ?? 0) + cachedInputTokens;
  modelUsage[model].cacheWriteTokens =
    (modelUsage[model].cacheWriteTokens ?? 0) + cacheWriteTokens;
}

function applyDelta(state: unknown, delta: unknown): unknown {
  if (!isObject(delta)) {
    return state;
  }

  const kind = delta.kind;
  const path = Array.isArray(delta.k) ? delta.k.map(String) : [];
  const value = delta.v;

  if (kind === 0) {
    return value;
  }

  if (path.length === 0) {
    return state;
  }

  const root: Record<string, unknown> = isObject(state) ? { ...state } : {};
  let current: unknown = root;

  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    const nextSegment = path[index + 1];
    const wantsArray = /^\d+$/.test(nextSegment);

    if (Array.isArray(current)) {
      const currentIndex = Number(segment);
      if (
        !isObject(current[currentIndex]) &&
        !Array.isArray(current[currentIndex])
      ) {
        current[currentIndex] = wantsArray ? [] : {};
      }
      current = current[currentIndex];
      continue;
    }

    if (!isObject(current)) {
      return root;
    }

    if (!isObject(current[segment]) && !Array.isArray(current[segment])) {
      current[segment] = wantsArray ? [] : {};
    }
    current = current[segment];
  }

  const lastSegment = path[path.length - 1];
  if (kind === 1) {
    if (Array.isArray(current) && /^\d+$/.test(lastSegment)) {
      current[Number(lastSegment)] = value;
    } else if (isObject(current)) {
      current[lastSegment] = value;
    }
    return root;
  }

  if (kind === 2) {
    if (Array.isArray(current) && /^\d+$/.test(lastSegment)) {
      const targetIndex = Number(lastSegment);
      if (!Array.isArray(current[targetIndex])) {
        current[targetIndex] = [];
      }
      const target = current[targetIndex] as unknown[];
      if (Array.isArray(value)) {
        target.push(...value);
      } else {
        target.push(value);
      }
    } else if (isObject(current)) {
      if (!Array.isArray(current[lastSegment])) {
        current[lastSegment] = [];
      }
      const target = current[lastSegment] as unknown[];
      if (Array.isArray(value)) {
        target.push(...value);
      } else {
        target.push(value);
      }
    }
  }

  return root;
}

function parseJsonl(content: string): unknown {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return undefined;
  }

  try {
    const first = JSON.parse(lines[0]);
    if (isObject(first) && typeof first.kind === "number") {
      let state: unknown = {};
      for (const line of lines) {
        try {
          state = applyDelta(state, JSON.parse(line));
        } catch {
          continue;
        }
      }
      return state;
    }
  } catch {
    return undefined;
  }

  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

function parseEventJsonlSession(
  fileContent: string,
  estimateTokensFromText: (text: string, model?: string) => number,
): ParsedSession | undefined {
  const lines = fileContent.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) {
    return undefined;
  }

  const model = "gpt-4o";
  const modelUsage: ModelUsage = {};
  let inputTokens = 0;
  let outputTokens = 0;
  let thinkingTokens = 0;
  let interactions = 0;
  let sawEvent = false;

  for (const line of lines) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObject(event) || typeof event.type !== "string") {
      continue;
    }
    sawEvent = true;
    const data = isObject(event.data) ? event.data : {};

    if (event.type === "user.message") {
      const text = typeof data.content === "string" ? data.content : "";
      if (text.trim()) {
        interactions += 1;
      }
      if (text) {
        const tokens = estimateTokensFromText(text, model);
        inputTokens += tokens;
        addModelUsage(modelUsage, model, tokens, 0);
      }
      continue;
    }

    if (event.type === "assistant.message") {
      const text = typeof data.content === "string" ? data.content : "";
      const reasoningText =
        typeof data.reasoningText === "string" ? data.reasoningText : "";
      if (text) {
        const tokens = estimateTokensFromText(text, model);
        outputTokens += tokens;
        addModelUsage(modelUsage, model, 0, tokens);
      }
      if (reasoningText) {
        const tokens = estimateTokensFromText(reasoningText, model);
        thinkingTokens += tokens;
        outputTokens += tokens;
        addModelUsage(modelUsage, model, 0, tokens);
      }
      continue;
    }

    if (event.type === "tool.execution_complete") {
      const result = isObject(data.result) ? data.result : undefined;
      const text =
        typeof result?.detailedContent === "string"
          ? result.detailedContent
          : typeof result?.content === "string"
            ? result.content
            : "";
      if (text) {
        const tokens = estimateTokensFromText(text, model);
        outputTokens += tokens;
        addModelUsage(modelUsage, model, 0, tokens);
      }
    }
  }

  if (!sawEvent) {
    return undefined;
  }

  return {
    tokens: inputTokens + outputTokens,
    inputTokens,
    outputTokens,
    thinkingTokens,
    interactions,
    aiCredits: 0,
    modelUsage,
  };
}

function safeJsonParse(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

export function parseSessionFileContent(
  filePath: string,
  fileContent: string,
  estimateTokensFromText: (text: string, model?: string) => number,
): ParsedSession {
  if (filePath.endsWith(".jsonl")) {
    const eventSession = parseEventJsonlSession(
      fileContent,
      estimateTokensFromText,
    );
    if (eventSession && eventSession.tokens > 0) {
      return eventSession;
    }
  }

  const parsed = filePath.endsWith(".jsonl")
    ? parseJsonl(fileContent)
    : safeJsonParse(fileContent);
  if (!isObject(parsed)) {
    return {
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      interactions: 0,
      aiCredits: 0,
      modelUsage: {},
    };
  }

  const requests = Array.isArray(parsed.requests)
    ? parsed.requests
    : Array.isArray(parsed.history)
      ? parsed.history
      : [];
  const modelUsage: ModelUsage = {};
  let inputTokens = 0;
  let outputTokens = 0;
  let thinkingTokens = 0;
  let interactions = 0;
  let aiCredits = 0;

  for (const request of requests) {
    if (!isObject(request)) {
      continue;
    }

    const selectedModel = isObject(request.selectedModel)
      ? request.selectedModel
      : undefined;
    const resultDetails = extractResultDetails(request.result);
    const model =
      resultDetails.model ??
      normalizeModelId(
        request.modelId ?? selectedModel?.identifier ?? request.model,
      );
    aiCredits += resultDetails.aiCredits;
    if (!modelUsage[model]) {
      modelUsage[model] = { inputTokens: 0, outputTokens: 0 };
    }

    const messageText =
      extractMessageText(request.message) ||
      (typeof request.prompt === "string" ? request.prompt : "");

    const responsePayload = extractResponseText(
      request.response ?? request.responses ?? request.turns ?? request.messages,
    );
    const usage = extractUsage(
      isObject(request.result)
        ? (request.result.usage ?? request.result)
        : request.result,
    );

    if (messageText.trim()) {
      interactions += 1;
    }

    if (usage) {
      const sessionInputTokens =
        usage.inputTokens ||
        (messageText ? estimateTokensFromText(messageText, model) : 0);
      const sessionOutputTokens =
        usage.outputTokens ||
        (responsePayload.text
          ? estimateTokensFromText(responsePayload.text, model)
          : 0);

      inputTokens += sessionInputTokens;
      outputTokens += sessionOutputTokens;
      thinkingTokens += usage.thinkingTokens;
      modelUsage[model].inputTokens += sessionInputTokens;
      modelUsage[model].outputTokens += sessionOutputTokens;
      modelUsage[model].cachedInputTokens =
        (modelUsage[model].cachedInputTokens ?? 0) + usage.cachedInputTokens;
      modelUsage[model].cacheWriteTokens =
        (modelUsage[model].cacheWriteTokens ?? 0) + usage.cacheWriteTokens;
      continue;
    }

    if (messageText) {
      const estimatedInputTokens = estimateTokensFromText(messageText, model);
      inputTokens += estimatedInputTokens;
      modelUsage[model].inputTokens += estimatedInputTokens;
    }

    if (responsePayload.text) {
      const estimatedOutputTokens = estimateTokensFromText(
        responsePayload.text,
        model,
      );
      outputTokens += estimatedOutputTokens;
      modelUsage[model].outputTokens += estimatedOutputTokens;
    }

    if (responsePayload.thinkingText) {
      const estimatedThinkingTokens = estimateTokensFromText(
        responsePayload.thinkingText,
        model,
      );
      thinkingTokens += estimatedThinkingTokens;
      outputTokens += estimatedThinkingTokens;
      modelUsage[model].outputTokens += estimatedThinkingTokens;
    }

    const responseItems = Array.isArray(request.response)
      ? request.response
      : Array.isArray(request.responses)
        ? request.responses
        : [];
    for (const responseItem of responseItems) {
      const subAgent = extractSubAgentText(responseItem);
      if (!subAgent) {
        continue;
      }

      const subAgentModel = normalizeModelId(subAgent.model, model);
      if (subAgent.prompt) {
        const estimatedInputTokens = estimateTokensFromText(
          subAgent.prompt,
          subAgentModel,
        );
        inputTokens += estimatedInputTokens;
        addModelUsage(modelUsage, subAgentModel, estimatedInputTokens, 0);
      }
      if (subAgent.result) {
        const estimatedOutputTokens = estimateTokensFromText(
          subAgent.result,
          subAgentModel,
        );
        outputTokens += estimatedOutputTokens;
        addModelUsage(modelUsage, subAgentModel, 0, estimatedOutputTokens);
      }
    }
  }

  return {
    tokens: inputTokens + outputTokens,
    inputTokens,
    outputTokens,
    thinkingTokens,
    interactions,
    aiCredits,
    modelUsage,
  };
}
