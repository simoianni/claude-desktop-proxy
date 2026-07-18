# Claude Desktop → DeepSeek / OpenCode Go / Gemini Proxy

A local HTTPS proxy that lets **Claude Desktop** use **DeepSeek**, **OpenCode Go**, and **Google Gemini Flash 2.5** APIs instead of Anthropic's official API — for a fraction of the cost.

```
                                                        ┌─→ DeepSeek API    (text & reasoning)
Claude Desktop → HTTPS (127.0.0.1:8877) → Local proxy ─┼─→ OpenCode Go     (text & reasoning, alternative)
                                                        └─→ Gemini Flash   (images & OCR)
```

## What you need

| Requirement | Notes |
|---|---|
| **Node.js v18+** | The setup script installs it automatically if missing (Windows) |
| **A text-provider API key** | Either **DeepSeek** (https://platform.deepseek.com — free credits on signup) **or** **OpenCode Go** (https://opencode.ai) — pick one during setup |
| **Gemini API key** | https://aistudio.google.com/apikey — 1000 req/day free, no credit card, always required (used for image OCR) |
| **Claude Desktop** | Already installed |

> **DeepSeek vs OpenCode Go:** both are Anthropic/OpenAI-compatible backends for text & reasoning. DeepSeek talks the proxy's native Anthropic-style format; **OpenCode Go** (opencode.ai) is routed through an OpenAI-compatible endpoint and is automatically translated to/from the Anthropic format by the proxy. The setup script asks you to choose one as your primary provider — you only need one key, not both. If `OPENCODE_API_KEY` is set, the proxy prefers OpenCode Go over DeepSeek for text requests.

---

## Quick start

### Windows

```cmd
setup.bat
```

Double-click `setup.bat` or run it from a terminal. The script will:

1. Install Node.js automatically if not found (via winget)
2. Ask you to choose a text provider — **DeepSeek** or **OpenCode Go**
3. Ask for your API keys (chosen provider + Gemini) and create `.env`
4. Generate TLS certificates (no OpenSSL needed — pure PowerShell)
5. Install the CA certificate in the Windows trust store
6. Write Claude Desktop config files
7. **Start the proxy** so Claude Desktop can connect immediately
8. Walk you through the two manual steps in Claude Desktop
9. Optionally register an auto-start task at Windows login

### Linux / macOS

```bash
chmod +x setup.sh
./setup.sh
```

Same flow — the script handles everything interactively.

---

## Model mapping

| Model in Claude Desktop | Backend (DeepSeek) | Backend (OpenCode Go) | Use for |
|---|---|---|---|
| `claude-sonnet-4-5` / `claude-sonnet-4-6` | DeepSeek V4 Flash | `deepseek-v4-flash` | Text, reasoning, chat |
| `claude-opus-4-7` | DeepSeek V4 Pro | `deepseek-v4-flash` | Complex reasoning |
| `claude-haiku-4-5-20251001` | DeepSeek V4 Flash | `deepseek-v4-flash` | Fast/cheap tasks |
| Images (auto-routed) | **Gemini Flash 2.5** | **Gemini Flash 2.5** | OCR, image analysis, vision |

Only one text backend is active at a time, based on which API key is configured in `.env` — **OpenCode Go takes priority over DeepSeek if both keys are present**. Images are always auto-detected and routed to Gemini regardless of the text backend, no manual model switching needed. Just use `claude-sonnet-4-5` for everything.

---

## Image pipeline

```
User uploads image
       │
       ▼
Proxy detects image → Gemini Flash 2.5 (OCR + description)
       │
       ▼
Description injected into request → DeepSeek (final response)
```

Supported formats: JPEG, PNG, WEBP, HEIC, HEIF

---

## Starting / stopping the proxy

**Start:**
```cmd
start.bat        # Windows
./start.sh       # Linux/macOS
node proxy/server.js  # any platform
```

**Stop:**
```cmd
taskkill /f /im node.exe    # Windows
pkill -f 'node.*server.js'  # Linux/macOS
```

**Auto-start at login (Windows):**  
The setup script offers this automatically. To remove it later:
```cmd
schtasks /delete /tn ClaudeDeepSeekProxy /f
```

---

## Project structure

```
/
├── setup.bat               Windows automated setup (interactive)
├── setup.sh                Linux/macOS automated setup (interactive)
├── start.bat               Windows quick launcher
├── start.sh                Linux/macOS quick launcher
├── .env.example            API keys template
├── proxy/
│   ├── server.js           The proxy server
│   └── test-proxy.js       Connectivity test
├── certs/
│   ├── generate-certs.ps1  Generate certs — Windows (PowerShell native, no OpenSSL)
│   ├── generate-certs.sh   Generate certs — Linux/macOS
│   ├── install-ca.ps1      Install CA in trust store — Windows
│   ├── install-ca.sh       Install CA in trust store — Linux/macOS
│   ├── ca.cnf              CA config (used by .sh only)
│   └── server.cnf          Server cert config (used by .sh only)
└── mcp-gemini-vision/      MCP Gemini Vision extension
```

---

## Security Hardening

This fork implements several security fixes to ensure the proxy is safe for local use:

- **Localhost Binding (`127.0.0.1`)**: The server listens exclusively on `127.0.0.1` instead of `0.0.0.0`. This prevents other devices on the same local area network (LAN) or the public internet from accessing your proxy and abusing your API keys.
- **CORS Restrictions**: Wildcard CORS headers (`Access-Control-Allow-Origin: *`) have been disabled. This prevents malicious websites loaded in your web browser from executing CSRF-like attacks (Confused Deputy) to query your local proxy.
- **Payload Size Limits**: Request bodies are capped at a maximum of **50 MB** to protect the node process against memory exhaustion (DoS attacks).
- **Strict Payload Validation**: Request bodies are validated as valid JSON objects before processing to prevent crashes or unexpected behavior from malformed input formats.
- **API Key Isolation**: Client-supplied `x-api-key` headers are not blindly forwarded to upstream endpoints, ensuring your configured API keys are kept isolated and secure.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `ERR_CERT_AUTHORITY_INVALID` | Run `certs\install-ca.ps1` (Windows) or `./certs/install-ca.sh` (macOS/Linux) |
| Model not visible in Claude Desktop | Only names with `-sonnet-`, `-opus-`, `-haiku-` are accepted |
| "server is busy" loop | The proxy is not running — start it with `start.bat` / `start.sh` |
| Image upload 503 | Use drag & drop or the `+` button — the Quick Entry shortcut bypasses the gateway |
| Gemini 429 rate limit | Free tier limit reached (1000 req/day) — wait or upgrade |

---

## Manual setup (advanced)

<details>
<summary>Click to expand — only needed if the automated setup fails</summary>

### 1. Clone and configure keys

```bash
git clone https://github.com/simoianni/claude-desktop-proxy.git
cd claude-desktop-proxy
cp .env.example .env    # Linux/macOS
copy .env.example .env  # Windows
```

Edit `.env` — set **one** of the two text-provider keys (`DEEPSEEK_API_KEY` or `OPENCODE_API_KEY`), plus Gemini:
```env
DEEPSEEK_API_KEY=sk-...          # https://platform.deepseek.com
OPENCODE_API_KEY=...             # https://opencode.ai — alternative to DeepSeek, takes priority if set
GEMINI_API_KEY=...               # https://aistudio.google.com/apikey
```

### 2. Generate TLS certificates

Claude Desktop requires HTTPS for gateway connections.

**Windows** (no OpenSSL needed):
```powershell
powershell -ExecutionPolicy Bypass -File certs\generate-certs.ps1
```

**Linux/macOS** (requires OpenSSL):
```bash
chmod +x certs/generate-certs.sh && ./certs/generate-certs.sh
```

### 3. Install the CA certificate

**Windows:**
```powershell
powershell -ExecutionPolicy Bypass -File certs\install-ca.ps1
```

**macOS:**
```bash
./certs/install-ca.sh
```

**Linux (Debian/Ubuntu/RHEL):**
```bash
sudo ./certs/install-ca.sh
```

### 4. Configure Claude Desktop

Create `developer_settings.json` in **both** paths:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\Claude\developer_settings.json` |
| Windows | `%LOCALAPPDATA%\Claude-3p\developer_settings.json` |
| macOS | `~/Library/Application Support/Claude/developer_settings.json` |
| macOS | `~/Library/Application Support/Claude-3p/developer_settings.json` |

```json
{
  "allowDevTools": true,
  "gateway": {
    "url": "https://localhost:8877"
  }
}
```

### 5. Enable Developer Mode and add models

1. Open Claude Desktop (**do not sign in** — stay on the login screen)
2. **Help → Troubleshooting → Enable Developer Mode**
3. **Developer → Configure third-party inference**
   - Inference provider: `Gateway`
   - Gateway base URL: `https://localhost:8877`
   - Gateway API key: `proxy-local-key`
   - Add models: `claude-sonnet-4-5` (label: `sonnet 4.5`) and `claude-opus-4-7` (label: `claude opus 4.7`)
4. Click **Apply locally**

### 6. Start the proxy and relaunch Claude Desktop

```bash
node proxy/server.js
```

Quit Claude Desktop completely (tray too), reopen it, and select one of the configured models.

</details>

---

## Technical notes

- **Why a local CA?** Claude Desktop's sandbox strictly verifies TLS chains. A self-signed cert without `CA:TRUE` in Basic Constraints is rejected.
- **Probe interception:** Claude Desktop sends `max_tokens=1` requests to validate connectivity. The proxy responds locally without hitting upstream APIs.
- **Port 8877:** Arbitrary — change it in `proxy/server.js` and in Claude Desktop settings.
- **OpenCode Go format translation:** DeepSeek speaks the proxy's native Anthropic-style messages format directly. OpenCode Go is OpenAI-compatible instead, so the proxy converts requests (`anthropicToOpenAIBody`) and responses (`openAIToAnthropicResponse` / SSE chunk translation) on the fly, including tool calls and streaming — Claude Desktop never sees the difference.
- **Text-provider selection:** configured in `proxy/server.js` under `ENDPOINTS` / `resolveEndpoint()`. Order of preference is OpenCode Go → DeepSeek → Gemini (for images); OpenCode Go is only used if `OPENCODE_API_KEY` is set in `.env`.
