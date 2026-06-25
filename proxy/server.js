const fs = require("fs");
const path = require("path");
const https = require("https");

// Load .env if present
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8").split("\n").forEach((line) => {
    const [k, ...v] = line.split("=");
    if (k && k.trim() && !k.trim().startsWith("#")) {
      process.env[k.trim()] = v.join("=").trim();
    }
  });
}

// ── Proxy Port ───────────────────────────────────────────
const PROXY_PORT = 8877;
const DIR = path.join(__dirname, "..");

// ── Endpoint Config ──────────────────────────────────────
const ENDPOINTS = {
  deepseek: {
    label: "DeepSeek",
    host: "api.deepseek.com",
    basePath: "/anthropic",
    apiKey: process.env.DEEPSEEK_API_KEY || null,
    modelMap: {
      "claude-sonnet-4-5": "deepseek-v4-flash",
      "claude-sonnet-4-6": "deepseek-v4-flash",
      "claude-opus-4-7": "deepseek-v4-pro",
      "claude-haiku-4-5-20251001": "deepseek-v4-flash",
    },
    defaultModel: "deepseek-v4-flash",
    type: "anthropic",
  },
  gemini: {
    label: "Gemini Flash",
    host: "generativelanguage.googleapis.com",
    basePath: "/v1beta/models",
    apiKey: process.env.GEMINI_API_KEY || null,
    model: "gemini-2.5-flash",
    type: "gemini",
  },
  opencode: {
    label: "OpenCode Go",
    host: "opencode.ai",
    basePath: "/zen/go/v1/chat/completions",
    apiKey: process.env.OPENCODE_API_KEY || null,
    modelMap: {
      "claude-sonnet-4-5": "deepseek-v4-flash",
      "claude-sonnet-4-6": "deepseek-v4-flash",
      "claude-opus-4-7": "deepseek-v4-flash",
      "claude-haiku-4-5-20251001": "deepseek-v4-flash",
    },
    defaultModel: "deepseek-v4-flash",
    type: "opencode",
  },
};
// ─────────────────────────────────────────────────────────

// Load TLS certs
const tlsOptions = {
  key: fs.readFileSync(path.join(DIR, "certs", "server-key.pem"), "utf8"),
  cert: fs.readFileSync(path.join(DIR, "certs", "server-cert.pem"), "utf8"),
};

// ── Helpers ──────────────────────────────────────────────

function resolveEndpoint(parsed) {
  const origModel = parsed.model || "unknown";

  // Check if any message contains images → route to Gemini
  const messages = parsed.messages || [];
  for (const msg of messages) {
    if (Array.isArray(msg.content) && msg.content.some((c) => c.type === "image")) {
      console.log(`[proxy] [IMAGE] image detected → routing to Gemini`);
      return { key: "gemini", ep: ENDPOINTS.gemini, upstreamModel: ENDPOINTS.gemini.model };
    }
  }

  // Prefer opencode over deepseek when API key is configured
  const endpointOrder = ["opencode", "deepseek", "gemini"];
  for (const key of endpointOrder) {
    const ep = ENDPOINTS[key];
    if (!ep) continue;
    if (key === "opencode" && !ep.apiKey) continue;
    if (ep.modelMap && ep.modelMap[origModel]) return { key, ep, upstreamModel: ep.modelMap[origModel] };
  }
  return { key: "deepseek", ep: ENDPOINTS.deepseek, upstreamModel: ENDPOINTS.deepseek.defaultModel };
}

function cleanSchema(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(cleanSchema);
  const keepKeys = new Set(["type", "description", "properties", "items",
    "required", "enum", "nullable", "format", "default", "minimum", "maximum",
    "minLength", "maxLength", "pattern", "title"]);
  const cleaned = {};
  for (const [k, v] of Object.entries(obj)) {
    if (keepKeys.has(k)) {
      cleaned[k] = cleanSchema(v);
    }
  }
  return cleaned;
}

// ── Anthropic → OpenAI format conversion ────────────────────

function anthropicToOpenAIBody(parsed) {
  const openAIMessages = [];
  let systemContent = parsed.system || "";

  for (const msg of parsed.messages || []) {
    if (msg.role === "system") {
      const text = typeof msg.content === "string" ? msg.content : msg.content.filter(b => b.type === "text").map(b => b.text).join("\n");
      systemContent += (systemContent ? "\n" : "") + text;
      continue;
    }

    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        openAIMessages.push({ role: "user", content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const parts = [];
        for (const block of msg.content) {
          if (block.type === "text") {
            parts.push({ type: "text", text: block.text });
          } else if (block.type === "image" && block.source) {
            const mime = block.source.media_type || "image/jpeg";
            parts.push({ type: "image_url", image_url: { url: `data:${mime};base64,${block.source.data}` } });
          } else if (block.type === "tool_result") {
            const toolText = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
            openAIMessages.push({ role: "tool", tool_call_id: block.tool_use_id, content: toolText });
          }
        }
        if (parts.length > 0) {
          openAIMessages.push({ role: "user", content: parts });
        }
      }
    } else if (msg.role === "assistant") {
      if (typeof msg.content === "string") {
        openAIMessages.push({ role: "assistant", content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const textParts = [];
        const toolCalls = [];
        for (const block of msg.content) {
          if (block.type === "text") {
            textParts.push(block.text);
          } else if (block.type === "tool_use") {
            toolCalls.push({
              id: block.id,
              type: "function",
              function: { name: block.name, arguments: JSON.stringify(block.input || {}) },
            });
          }
        }
        const entry = { role: "assistant" };
        entry.content = textParts.length > 0 ? textParts.join("\n") : null;
        if (toolCalls.length > 0) entry.tool_calls = toolCalls;
        openAIMessages.push(entry);
      }
    }
  }

  if (systemContent) {
    openAIMessages.unshift({ role: "system", content: systemContent });
  }

  const body = {
    model: parsed.model,
    messages: openAIMessages,
    max_tokens: Math.max(parsed.max_tokens || 8192, 1024),
    stream: !!parsed.stream,
    thinking: { type: "disabled" },
  };

  if (parsed.temperature !== undefined) body.temperature = parsed.temperature;
  if (parsed.top_p !== undefined) body.top_p = parsed.top_p;

  if (parsed.tools && Array.isArray(parsed.tools)) {
    body.tools = parsed.tools.map(t => ({
      type: "function",
      function: { name: t.name, description: t.description || "", parameters: cleanSchema(t.input_schema) },
    }));
  }

  return body;
}

function openAIToAnthropicResponse(raw, origModel) {
  const choice = raw.choices?.[0] || {};
  const msg = choice.message || {};
  const content = [];

  if (msg.content) {
    content.push({ type: "text", text: msg.content });
  } else if (msg.reasoning_content) {
    content.push({ type: "text", text: msg.reasoning_content });
  }

  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments || "{}") });
    }
  }

  const finishMap = { "stop": "end_turn", "length": "max_tokens", "tool_calls": "end_turn" };
  const usage = raw.usage || {};

  return {
    id: "msg_" + Math.random().toString(36).substring(2, 15),
    type: "message",
    role: "assistant",
    model: origModel,
    content: content.length > 0 ? content : [{ type: "text", text: "" }],
    stop_reason: finishMap[choice.finish_reason] || "end_turn",
    stop_sequence: null,
    usage: { input_tokens: usage.prompt_tokens || 0, output_tokens: usage.completion_tokens || 0 },
  };
}

function openAIChunkToAnthropicSSE(chunk, origModel, state) {
  const choice = chunk.choices?.[0] || {};
  const delta = choice.delta || {};
  const finishReason = choice.finish_reason;

  const text = delta.content || delta.reasoning_content || "";

  if (!state.started) {
    state.started = true;
    return {
      type: "message_start",
      message: {
        id: "msg_" + Math.random().toString(36).substring(2, 15),
        type: "message",
        role: "assistant",
        model: origModel,
        content: [],
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    };
  }

  if (text && !state.blockStarted) {
    state.blockStarted = true;
    return {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    };
  }

  if (text) {
    return {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    };
  }

  if (finishReason) {
    const events = [];
    if (state.blockStarted) {
      events.push({ type: "content_block_stop", index: 0 });
    }
    const stopMap = { "stop": "end_turn", "length": "max_tokens", "tool_calls": "end_turn" };
    events.push({
      type: "message_delta",
      delta: { stop_reason: stopMap[finishReason] || "end_turn", stop_sequence: null },
      usage: { input_tokens: chunk.usage?.prompt_tokens || 0, output_tokens: chunk.usage?.completion_tokens || 0 },
    });
    events.push({ type: "message_stop" });
    return events;
  }

  return null;
}

// ───────────────────────────────────────────────────────────

function anthropicToGeminiContents(parsed, origModel) {
  const contents = [];
  let systemInstruction = null;
  const systemParts = [];
  const messages = parsed.messages || [];
  let hasSystem = false;

  for (const msg of messages) {
    if (msg.role === "system") {
      hasSystem = true;
      if (typeof msg.content === "string") {
        systemParts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "text") systemParts.push({ text: block.text });
        }
      }
      continue;
    }

    const role = msg.role === "assistant" ? "model" : "user";
    const parts = [];
    if (typeof msg.content === "string") {
      parts.push({ text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "text") {
          parts.push({ text: block.text });
        } else if (block.type === "image") {
          let mimeType = "image/jpeg";
          let data = "";
          if (block.source) {
            mimeType = block.source.media_type || "image/jpeg";
            data = block.source.data || "";
          }
          parts.push({ inlineData: { mimeType, data } });
        } else if (block.type === "tool_use") {
          parts.push({ text: JSON.stringify({ type: "tool_use", name: block.name, input: block.input, id: block.id }) });
        } else if (block.type === "tool_result") {
          parts.push({ text: JSON.stringify({ type: "tool_result", tool_use_id: block.tool_use_id, content: block.content }) });
        }
      }
    }
    contents.push({ role, parts });
  }

  if (systemParts.length > 0) {
    systemInstruction = { parts: systemParts };
  }

  const genConfig = {};
  if (parsed.max_tokens) genConfig.maxOutputTokens = Math.min(parsed.max_tokens, 8192);
  if (parsed.temperature !== undefined) genConfig.temperature = parsed.temperature;
  if (parsed.top_p !== undefined) genConfig.topP = parsed.top_p;

  const tools = [];
  if (parsed.tools && Array.isArray(parsed.tools)) {
    for (const tool of parsed.tools) {
      if (tool.name && tool.input_schema) {
        tools.push({
          functionDeclarations: [{
            name: tool.name,
            description: tool.description || "",
            parameters: cleanSchema(tool.input_schema),
          }],
        });
      }
    }
  }

  const body = { contents, generationConfig: genConfig };
  if (systemInstruction) body.systemInstruction = systemInstruction;
  // Strip tools for Gemini (not needed for vision/OCR, and schema incompatibilities cause 400)
  if (body.tools) delete body.tools;

  return body;
}

function geminiToAnthropicResponse(geminiResp, origModel) {
  const candidate = geminiResp.candidates?.[0] || {};
  const parts = candidate.content?.parts || [];
  const finishReason = candidate.finishReason || "STOP";

  const stopReasonMap = {
    "STOP": "end_turn",
    "MAX_TOKENS": "max_tokens",
    "SAFETY": "end_turn",
    "RECITATION": "end_turn",
  };

  const content = [];
  for (const part of parts) {
    if (part.text) {
      content.push({ type: "text", text: part.text });
    } else if (part.functionCall) {
      content.push({
        type: "tool_use",
        id: "toolu_" + Math.random().toString(36).substring(2, 15),
        name: part.functionCall.name,
        input: part.functionCall.args || {},
      });
    }
  }

  const usage = geminiResp.usageMetadata || {};
  return {
    id: "msg_" + Math.random().toString(36).substring(2, 15),
    type: "message",
    role: "assistant",
    model: origModel,
    content: content.length > 0 ? content : [{ type: "text", text: "" }],
    stop_reason: stopReasonMap[finishReason] || "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: usage.promptTokenCount || 0,
      output_tokens: usage.candidatesTokenCount || 0,
    },
  };
}

// ── Image pipeline ─────────────────────────────────────────
function handleImagePipeline(req, res, parsed, origModel) {
  const geminiEp = ENDPOINTS.gemini;
  const deepseekEp = ENDPOINTS.deepseek;

  console.log(`[proxy] [IMAGE] === Image → Gemini OCR → DeepSeek pipeline ===`);

  const geminiBody = anthropicToGeminiContents(parsed, origModel);
  const geminiBodyStr = JSON.stringify(geminiBody);
  const geminiPath = geminiEp.basePath + "/" + geminiEp.model + ":generateContent?key=" + (geminiEp.apiKey || "");

  console.log(`[proxy] [IMAGE] sending to Gemini (${geminiBodyStr.length} bytes)`);

  const geminiReq = https.request({
    hostname: geminiEp.host, port: 443, path: geminiPath, method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(geminiBodyStr) },
  }, (geminiRes) => {
    let gd = "";
    geminiRes.on("data", (c) => (gd += c));
    geminiRes.on("end", () => {
      console.log(`[proxy] [IMAGE] Gemini response: ${geminiRes.statusCode} (${gd.length} bytes)`);
      let imageDescription = "";
      try {
        const gr = JSON.parse(gd);
        const parts = gr.candidates?.[0]?.content?.parts || [];
        imageDescription = parts.map((p) => p.text || "").join("").trim();
      } catch { /* use empty description if Gemini fails */ }

      if (!imageDescription) {
        console.log(`[proxy] [IMAGE] Gemini returned no description (status ${geminiRes.statusCode}), removing images from request`);
      } else {
        console.log(`[proxy] [IMAGE] description (${imageDescription.length} chars): ${imageDescription.substring(0, 200)}...`);
      }

      const dsModel = deepseekEp.modelMap[origModel] || deepseekEp.defaultModel;
      parsed.model = dsModel;

      if (!parsed.max_tokens || parsed.max_tokens < 1024) parsed.max_tokens = 8192;

      if (parsed.messages) {
        for (const msg of parsed.messages) {
          if (Array.isArray(msg.content)) {
            const newContent = [];
            const userTextParts = [];
            let hasImage = false;
            for (const block of msg.content) {
              if (block.type === "image") {
                hasImage = true;
              } else if (block.type === "text") {
                userTextParts.push(block.text);
              } else {
                newContent.push(block);
              }
            }
            if (hasImage) {
              const userText = userTextParts.join("\n");
              let imageText;
              if (imageDescription) {
                imageText = userText
                  ? userText + "\n\nL'utente ha caricato un'immagine. Ecco la sua descrizione dettagliata:\n" + imageDescription
                  : imageDescription;
              } else {
                imageText = userText
                  ? userText + "\n\n[Immagine non analizzabile]"
                  : "Immagine caricata";
              }
              newContent.unshift({ type: "text", text: imageText });
            }
            if (newContent.length > 0) {
              msg.content = newContent;
            }
          }
        }
      }

      console.log(`[proxy] [IMAGE] model map: ${origModel} → ${dsModel}`);

      const newBody = JSON.stringify(parsed);
      const dsPath = deepseekEp.basePath + req.url.split("?")[0];
      const dsOpts = {
        hostname: deepseekEp.host, port: 443, path: dsPath, method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(newBody),
          "x-api-key": deepseekEp.apiKey || req.headers["x-api-key"] || "",
          "anthropic-version": req.headers["anthropic-version"] || "2023-06-01",
        },
      };

      console.log(`[proxy] [IMAGE] forwarding to DeepSeek (${newBody.length} bytes, stream=${!!parsed.stream})`);

      const dsReq = https.request(dsOpts, (dsRes) => {
        const isSSE = (dsRes.headers["content-type"] || "").includes("text/event-stream");
        res.writeHead(dsRes.statusCode, {
          "Content-Type": dsRes.headers["content-type"] || "application/json",
          "Access-Control-Allow-Origin": "*",
        });

        if (isSSE) {
          let buf = "";
          dsRes.on("data", (chunk) => {
            buf += chunk.toString();
            const lines = buf.split("\n");
            buf = lines.pop() || "";
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const d = line.substring(6).trim();
                if (d === "[DONE]") { res.write("data: [DONE]\n\n"); continue; }
                try {
                  const ev = JSON.parse(d);
                  if (ev.type === "message_start" && ev.message?.model) ev.message.model = origModel;
                  res.write("data: " + JSON.stringify(ev) + "\n\n");
                } catch { res.write(line + "\n"); }
              } else { res.write(line + "\n"); }
            }
          });
          dsRes.on("end", () => { if (buf) res.write(buf + "\n"); res.end(); console.log("[proxy] [IMAGE] DeepSeek stream complete"); });
        } else {
          let dd = "";
          dsRes.on("data", (c) => (dd += c));
          dsRes.on("end", () => {
            console.log(`[proxy] [IMAGE] DeepSeek response: ${dsRes.statusCode} (${dd.length} bytes)`);
            try {
              const r = JSON.parse(dd);
              r.model = origModel;
              res.end(JSON.stringify(r));
            } catch { res.end(dd); }
          });
        }
      });

      dsReq.on("error", (e) => {
        console.error("[proxy] [IMAGE] deepseek error:", e.message);
        if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { message: e.message } }));
      });
      dsReq.write(newBody);
      dsReq.end();
    });
  });

  geminiReq.on("error", (e) => {
    console.error("[proxy] [IMAGE] gemini error:", e.message);
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { message: e.message } }));
  });
  geminiReq.write(geminiBodyStr);
  geminiReq.end();
}

// ── Request handler ──────────────────────────────────────

function handleRequest(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    return res.end();
  }

  if (req.method === "GET") {
    const models = {};
    for (const [key, ep] of Object.entries(ENDPOINTS)) {
      if (ep.modelMap) {
        for (const [cModel, uModel] of Object.entries(ep.modelMap)) {
          models[cModel] = `${key}:${uModel}`;
        }
      }
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      status: "ok",
      proxy: "claude-deepseek-proxy",
      endpoints: "DeepSeek + Gemini Flash (auto image routing) + OpenCode Go",
      models,
    }));
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    let parsed;
    try { parsed = JSON.parse(body); } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Invalid JSON" }));
    }

    const origModel = parsed.model || "unknown";
    const origMaxTokens = parsed.max_tokens;
    const { key: epKey, ep, upstreamModel } = resolveEndpoint(parsed);

    console.log(`[proxy] incoming: model=${origModel}, max_tokens=${origMaxTokens}, stream=${!!parsed.stream}, endpoint=${epKey}`);

    // ── INTERCEPT PROBES ──────────────────────────────
    if (origMaxTokens !== undefined && origMaxTokens <= 1 && !parsed.stream) {
      const probeResp = {
        id: "msg_" + Math.random().toString(36).substring(2, 15),
        type: "message",
        role: "assistant",
        model: origModel,
        content: [{ type: "text", text: "Hi" }],
        stop_reason: "max_tokens",
        stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 1 },
      };
      console.log(`[proxy] ← PROBE response`);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(probeResp));
    }

    // ── Route to DeepSeek (Anthropic format) ────────
    if (ep.type === "anthropic") {
      parsed.model = upstreamModel;
      console.log(`[proxy] model map: ${origModel} → ${upstreamModel}`);

      if (!parsed.max_tokens || parsed.max_tokens < 1024) parsed.max_tokens = 8192;

      const newBody = JSON.stringify(parsed);
      const upstreamPath = ep.basePath + req.url.split("?")[0];
      const options = {
        hostname: ep.host,
        port: 443,
        path: upstreamPath,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(newBody),
          "x-api-key": ep.apiKey || req.headers["x-api-key"] || "",
          "anthropic-version": req.headers["anthropic-version"] || "2023-06-01",
        },
      };

      console.log(`[proxy] → POST https://${ep.host}${upstreamPath} (${newBody.length} bytes, stream=${!!parsed.stream})`);

      const upstream = https.request(options, (upstreamRes) => {
        const isSSE = (upstreamRes.headers["content-type"] || "").includes("text/event-stream");
        const respHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": upstreamRes.headers["content-type"] || "application/json",
        };
        res.writeHead(upstreamRes.statusCode, respHeaders);

        if (isSSE) {
          let buffer = "";
          upstreamRes.on("data", (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.substring(6).trim();
                if (data === "[DONE]") { res.write("data: [DONE]\n\n"); continue; }
                try {
                  const event = JSON.parse(data);
                  if (event.type === "message_start" && event.message?.model) event.message.model = origModel;
                  res.write("data: " + JSON.stringify(event) + "\n\n");
                } catch { res.write(line + "\n"); }
              } else { res.write(line + "\n"); }
            }
          });
          upstreamRes.on("end", () => { if (buffer) res.write(buffer + "\n"); res.end(); console.log("[proxy] ← stream complete"); });
        } else {
          let d = "";
          upstreamRes.on("data", (c) => (d += c));
          upstreamRes.on("end", () => {
            console.log(`[proxy] ← ${upstreamRes.statusCode >= 400 ? "ERR" : "OK"} ${upstreamRes.statusCode} (${d.length} bytes)`);
            try {
              const resp = JSON.parse(d);
              resp.model = origModel;
              res.end(JSON.stringify(resp));
            } catch { res.end(d); }
          });
        }
      });

      upstream.on("error", (err) => {
        console.error("[proxy] upstream error:", err.message);
        if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { message: err.message } }));
      });
      upstream.write(newBody);
      upstream.end();
      return;
    }

    // ── Route to OpenCode (OpenAI format) ──────────
    if (ep.type === "opencode") {
      parsed.model = upstreamModel;
      if (!parsed.max_tokens || parsed.max_tokens < 1024) parsed.max_tokens = 8192;

      const openAIBody = anthropicToOpenAIBody(parsed);
      const newBody = JSON.stringify(openAIBody);
      const upstreamPath = ep.basePath;

      const options = {
        hostname: ep.host,
        port: 443,
        path: upstreamPath,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(newBody),
          "Authorization": "Bearer " + (ep.apiKey || ""),
        },
      };

      console.log(`[proxy] [OPENCODE] model map: ${origModel} → ${upstreamModel}`);
      console.log(`[proxy] [OPENCODE] → POST https://${ep.host}${upstreamPath} (${newBody.length} bytes, stream=${!!parsed.stream})`);

      const upstream = https.request(options, (upstreamRes) => {
        const isSSE = (upstreamRes.headers["content-type"] || "").includes("text/event-stream");

        if (upstreamRes.statusCode >= 400) {
          let errBuf = "";
          upstreamRes.on("data", (c) => (errBuf += c));
          upstreamRes.on("end", () => {
            console.error(`[proxy] [OPENCODE] ⚠ ERROR ${upstreamRes.statusCode}: ${errBuf.substring(0, 500)}`);
            if (!res.headersSent) res.writeHead(upstreamRes.statusCode, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
            res.end(JSON.stringify({ type: "error", error: { message: `opencode API ${upstreamRes.statusCode}` } }));
          });
          return;
        }

        if (isSSE) {
          res.writeHead(200, { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*" });

          let buffer = "";
          const sseState = { started: false, blockStarted: false };

          upstreamRes.on("data", (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.substring(6).trim();
                if (data === "[DONE]") { res.write("data: [DONE]\n\n"); continue; }
                try {
                  const chunkEvent = JSON.parse(data);
                  const events = openAIChunkToAnthropicSSE(chunkEvent, origModel, sseState);
                  if (Array.isArray(events)) {
                    for (const ev of events) {
                      if (ev.type === "message_start" && ev.message?.model) ev.message.model = origModel;
                      res.write("data: " + JSON.stringify(ev) + "\n\n");
                    }
                  } else if (events) {
                    res.write("data: " + JSON.stringify(events) + "\n\n");
                  }
                } catch { res.write(line + "\n"); }
              } else { res.write(line + "\n"); }
            }
          });

          upstreamRes.on("end", () => {
            if (buffer) res.write(buffer + "\n");
            res.end();
            console.log(`[proxy] [OPENCODE] ← stream complete`);
          });
        } else {
          const respHeaders = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
          res.writeHead(upstreamRes.statusCode, respHeaders);

          let d = "";
          upstreamRes.on("data", (c) => (d += c));
          upstreamRes.on("end", () => {
            console.log(`[proxy] [OPENCODE] ← ${upstreamRes.statusCode} (${d.length} bytes)`);
            try {
              const raw = JSON.parse(d);
              const anthropicResp = openAIToAnthropicResponse(raw, origModel);
              res.end(JSON.stringify(anthropicResp));
            } catch { res.end(d); }
          });
        }
      });

      upstream.on("error", (err) => {
        console.error("[proxy] [OPENCODE] upstream error:", err.message);
        if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { message: err.message } }));
      });

      upstream.write(newBody);
      upstream.end();
      return;
    }

    // ── Image → Gemini OCR → DeepSeek pipeline ─────
    if (ep.type === "gemini") {
      handleImagePipeline(req, res, parsed, origModel);
      return;
    }
  });
}

function geminiToAnthropicSSE(geminiChunk, origModel, state) {
  const candidates = geminiChunk.candidates || [];
  if (candidates.length === 0) return null;

  if (!state.started) {
    state.started = true;
    return {
      type: "message_start",
      message: {
        id: "msg_" + Math.random().toString(36).substring(2, 15),
        type: "message",
        role: "assistant",
        model: origModel,
        content: [],
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    };
  }

  const candidate = candidates[0];
  const parts = candidate.content?.parts || [];

  const texts = [];
  for (const part of parts) {
    if (part.text) texts.push(part.text);
  }

  if (texts.length > 0 && !state.blockStarted) {
    state.blockStarted = true;
    return {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    };
  }

  if (texts.length > 0) {
    return {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: texts.join("") },
    };
  }

  const finishReason = candidate.finishReason;
  if (finishReason) {
    const events = [];
    if (state.blockStarted) {
      events.push({ type: "content_block_stop", index: 0 });
    }
    const stopReasonMap = { "STOP": "end_turn", "MAX_TOKENS": "max_tokens" };
    events.push({
      type: "message_delta",
      delta: { stop_reason: stopReasonMap[finishReason] || "end_turn", stop_sequence: null },
      usage: {
        input_tokens: geminiChunk.usageMetadata?.promptTokenCount || 0,
        output_tokens: geminiChunk.usageMetadata?.candidatesTokenCount || 0,
      },
    });
    events.push({ type: "message_stop" });
    return events;
  }

  return null;
}

// ── Startup ───────────────────────────────────────────────
function startServer() {
  const server = https.createServer(tlsOptions, handleRequest);
  server.listen(PROXY_PORT, "0.0.0.0", () => {
    console.log(`\n  Claude → Multi-Backend Proxy (HTTPS)`);
    console.log(`  Listening:    https://0.0.0.0:${PROXY_PORT}`);
    console.log(`  DeepSeek:     text only`);
    console.log(`  Gemini Flash: auto image/OCR routing`);
    console.log(`  OpenCode Go:  OpenAI-compatible (deepseek-v4-flash)`);
    for (const [key, ep] of Object.entries(ENDPOINTS)) {
      if (ep.modelMap) {
        for (const [cModel, uModel] of Object.entries(ep.modelMap)) {
          console.log(`    ${cModel} → ${uModel}`);
        }
      }
    }
    console.log("");
  });
}

startServer();
