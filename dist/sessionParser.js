function isObject(value) {
    return typeof value === "object" && value !== null;
}
function normalizeModelId(model, fallback = "gpt-4o") {
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
function getNestedObject(value, key) {
    if (!isObject(value)) {
        return undefined;
    }
    const nested = value[key];
    return isObject(nested) ? nested : undefined;
}
function extractUsage(value) {
    if (!isObject(value)) {
        return undefined;
    }
    const record = value;
    const metadata = isObject(record.metadata) ? record.metadata : undefined;
    const usage = isObject(record.usage) ? record.usage : undefined;
    const candidates = [usage, metadata, record].filter(isObject);
    for (const candidate of candidates) {
        const inputTokens = getNumber(candidate.promptTokens) ??
            getNumber(candidate.inputTokens) ??
            getNumber(candidate.prompt_tokens) ??
            getNumber(candidate.input_tokens) ??
            0;
        const outputBase = getNumber(candidate.outputTokens) ??
            getNumber(candidate.completionTokens) ??
            getNumber(candidate.output_tokens) ??
            getNumber(candidate.completion_tokens) ??
            0;
        const thinkingTokens = getNumber(candidate.reasoningTokens) ??
            getNumber(candidate.thinkingTokens) ??
            getNumber(candidate.reasoning_tokens) ??
            getNumber(candidate.thinking_tokens) ??
            0;
        if (inputTokens > 0 || outputBase > 0 || thinkingTokens > 0) {
            return {
                inputTokens,
                outputTokens: outputBase + thinkingTokens,
                thinkingTokens,
            };
        }
    }
    const inputTokens = getNumber(record.promptTokens) ?? getNumber(record.inputTokens) ?? 0;
    const outputBase = getNumber(record.outputTokens) ?? getNumber(record.completionTokens) ?? 0;
    const thinkingTokens = getNumber(record.reasoningTokens) ?? getNumber(record.thinkingTokens) ?? 0;
    if (inputTokens === 0 && outputBase === 0 && thinkingTokens === 0) {
        return undefined;
    }
    return {
        inputTokens,
        outputTokens: outputBase + thinkingTokens,
        thinkingTokens,
    };
}
function getNumber(value) {
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : undefined;
}
function extractResponseText(response) {
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
function extractMessageText(message) {
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
        .map((part) => isObject(part) && typeof part.text === "string" ? part.text : "")
        .join("");
}
function stringifyStreamingText(value) {
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
function extractSubAgentText(item) {
    if (!isObject(item) || item.kind !== "toolInvocationSerialized") {
        return undefined;
    }
    const toolSpecificData = getNestedObject(item, "toolSpecificData");
    if (!toolSpecificData || toolSpecificData.kind !== "subagent") {
        return undefined;
    }
    const prompt = typeof toolSpecificData.prompt === "string" ? toolSpecificData.prompt : "";
    const result = stringifyStreamingText(toolSpecificData.result);
    const model = typeof toolSpecificData.modelName === "string"
        ? toolSpecificData.modelName.trim().toLowerCase().replace(/\s+/g, "-")
        : undefined;
    if (!prompt && !result) {
        return undefined;
    }
    return { prompt, result, model };
}
function addModelUsage(modelUsage, model, inputTokens, outputTokens) {
    if (!modelUsage[model]) {
        modelUsage[model] = { inputTokens: 0, outputTokens: 0 };
    }
    modelUsage[model].inputTokens += inputTokens;
    modelUsage[model].outputTokens += outputTokens;
}
function applyDelta(state, delta) {
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
    const root = isObject(state) ? { ...state } : {};
    let current = root;
    for (let index = 0; index < path.length - 1; index += 1) {
        const segment = path[index];
        const nextSegment = path[index + 1];
        const wantsArray = /^\d+$/.test(nextSegment);
        if (Array.isArray(current)) {
            const currentIndex = Number(segment);
            if (!isObject(current[currentIndex]) &&
                !Array.isArray(current[currentIndex])) {
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
        }
        else if (isObject(current)) {
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
            const target = current[targetIndex];
            if (Array.isArray(value)) {
                target.push(...value);
            }
            else {
                target.push(value);
            }
        }
        else if (isObject(current)) {
            if (!Array.isArray(current[lastSegment])) {
                current[lastSegment] = [];
            }
            const target = current[lastSegment];
            if (Array.isArray(value)) {
                target.push(...value);
            }
            else {
                target.push(value);
            }
        }
    }
    return root;
}
function parseJsonl(content) {
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length === 0) {
        return undefined;
    }
    try {
        const first = JSON.parse(lines[0]);
        if (isObject(first) && typeof first.kind === "number") {
            let state = {};
            for (const line of lines) {
                try {
                    state = applyDelta(state, JSON.parse(line));
                }
                catch {
                    continue;
                }
            }
            return state;
        }
    }
    catch {
        return undefined;
    }
    try {
        return JSON.parse(content);
    }
    catch {
        return undefined;
    }
}
function parseEventJsonlSession(fileContent, estimateTokensFromText) {
    const lines = fileContent.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length === 0) {
        return undefined;
    }
    const model = "gpt-4o";
    const modelUsage = {};
    let inputTokens = 0;
    let outputTokens = 0;
    let thinkingTokens = 0;
    let interactions = 0;
    let sawEvent = false;
    for (const line of lines) {
        let event;
        try {
            event = JSON.parse(line);
        }
        catch {
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
            const reasoningText = typeof data.reasoningText === "string" ? data.reasoningText : "";
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
            const text = typeof result?.detailedContent === "string"
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
        modelUsage,
    };
}
function safeJsonParse(content) {
    try {
        return JSON.parse(content);
    }
    catch {
        return undefined;
    }
}
export function parseSessionFileContent(filePath, fileContent, estimateTokensFromText) {
    if (filePath.endsWith(".jsonl")) {
        const eventSession = parseEventJsonlSession(fileContent, estimateTokensFromText);
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
            modelUsage: {},
        };
    }
    const requests = Array.isArray(parsed.requests)
        ? parsed.requests
        : Array.isArray(parsed.history)
            ? parsed.history
            : [];
    const modelUsage = {};
    let inputTokens = 0;
    let outputTokens = 0;
    let thinkingTokens = 0;
    let interactions = 0;
    for (const request of requests) {
        if (!isObject(request)) {
            continue;
        }
        const selectedModel = isObject(request.selectedModel)
            ? request.selectedModel
            : undefined;
        const model = normalizeModelId(request.modelId ?? selectedModel?.identifier ?? request.model);
        if (!modelUsage[model]) {
            modelUsage[model] = { inputTokens: 0, outputTokens: 0 };
        }
        const messageText = extractMessageText(request.message) ||
            (typeof request.prompt === "string" ? request.prompt : "");
        const responsePayload = extractResponseText(request.response ?? request.responses ?? request.turns ?? request.messages);
        const usage = extractUsage(isObject(request.result)
            ? (request.result.usage ?? request.result)
            : request.result);
        if (messageText.trim()) {
            interactions += 1;
        }
        if (usage) {
            const sessionInputTokens = usage.inputTokens ||
                (messageText ? estimateTokensFromText(messageText, model) : 0);
            const sessionOutputTokens = usage.outputTokens ||
                (responsePayload.text
                    ? estimateTokensFromText(responsePayload.text, model)
                    : 0);
            inputTokens += sessionInputTokens;
            outputTokens += sessionOutputTokens;
            thinkingTokens += usage.thinkingTokens;
            modelUsage[model].inputTokens += sessionInputTokens;
            modelUsage[model].outputTokens += sessionOutputTokens;
            continue;
        }
        if (messageText) {
            const estimatedInputTokens = estimateTokensFromText(messageText, model);
            inputTokens += estimatedInputTokens;
            modelUsage[model].inputTokens += estimatedInputTokens;
        }
        if (responsePayload.text) {
            const estimatedOutputTokens = estimateTokensFromText(responsePayload.text, model);
            outputTokens += estimatedOutputTokens;
            modelUsage[model].outputTokens += estimatedOutputTokens;
        }
        if (responsePayload.thinkingText) {
            const estimatedThinkingTokens = estimateTokensFromText(responsePayload.thinkingText, model);
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
                const estimatedInputTokens = estimateTokensFromText(subAgent.prompt, subAgentModel);
                inputTokens += estimatedInputTokens;
                addModelUsage(modelUsage, subAgentModel, estimatedInputTokens, 0);
            }
            if (subAgent.result) {
                const estimatedOutputTokens = estimateTokensFromText(subAgent.result, subAgentModel);
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
        modelUsage,
    };
}
