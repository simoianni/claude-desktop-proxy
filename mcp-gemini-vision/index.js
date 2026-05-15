import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import https from "https";
import path from "path";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_HOST = "generativelanguage.googleapis.com";

const server = new Server(
  { name: "gemini-vision-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".heic": "image/heic",
    ".heif": "image/heif",
  };
  return map[ext] || "image/png";
}

function analyzeImage(filePath, prompt) {
  return new Promise((resolve, reject) => {
    const data = fs.readFileSync(filePath);
    const base64 = data.toString("base64");
    const mimeType = getMimeType(filePath);

    const body = JSON.stringify({
      contents: [{
        parts: [
          { text: prompt || "Descrivi questa immagine in dettaglio in italiano." },
          { inlineData: { mimeType, data: base64 } },
        ],
      }],
    });

    const req = https.request({
      hostname: GEMINI_HOST,
      port: 443,
      path: `/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Gemini error ${res.statusCode}: ${d.substring(0, 300)}`));
          return;
        }
        try {
          const gr = JSON.parse(d);
          const parts = gr.candidates?.[0]?.content?.parts || [];
          const text = parts.map((p) => p.text || "").join("").trim();
          resolve(text || "Nessuna descrizione restituita da Gemini.");
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: "analyze_image",
    description: "Analizza un'immagine usando Gemini Flash. Restituisce una descrizione visiva dettagliata in italiano.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Percorso assoluto del file immagine (.png, .jpg, .gif, .webp, .bmp)",
        },
        prompt: {
          type: "string",
          description: "Prompt opzionale per guidare l'analisi (es. 'cosa vedi?', 'leggi il testo in questa immagine')",
        },
      },
      required: ["file_path"],
    },
  }],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name !== "analyze_image") {
    throw new Error(`Tool sconosciuto: ${name}`);
  }

  if (!GEMINI_API_KEY) {
    return {
      content: [{ type: "text", text: "ERRORE: GEMINI_API_KEY non impostata. Copia .env.example in .env e inserisci la chiave." }],
      isError: true,
    };
  }

  const filePath = args?.file_path;
  if (!filePath || typeof filePath !== "string") {
    return {
      content: [{ type: "text", text: "ERRORE: parametro 'file_path' obbligatorio." }],
      isError: true,
    };
  }

  if (!fs.existsSync(filePath)) {
    return {
      content: [{ type: "text", text: `ERRORE: file non trovato: ${filePath}` }],
      isError: true,
    };
  }

  const prompt = typeof args?.prompt === "string" ? args.prompt : undefined;

  try {
    const description = await analyzeImage(filePath, prompt);
    return {
      content: [{ type: "text", text: description }],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `ERRORE: ${err.message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Gemini Vision server avviato su stdio");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
