# Claude Desktop → Multi-Backend Proxy

A local HTTPS proxy that lets **Claude Desktop** use **DeepSeek** and **Google Gemini Flash 2.5** APIs instead of Anthropic's official API.

## How it works

```
Claude Desktop → HTTPS (127.0.0.1:8877) → Local proxy ─┬─→ DeepSeek API (text)
                                                       └─→ Gemini Flash (OCR/images)
```

The proxy:
- Intercepts Claude Desktop validation probes (`max_tokens=1`) and responds locally
- Maps Claude model names → DeepSeek / Gemini model names
- Restores the original model name in the response
- Handles both streaming (SSE) and non-streaming requests
- **Auto-detects images** → Gemini Flash OCR → feeds description to DeepSeek for the final response

## Model mapping

| Claude Desktop model | Backend | Capability |
|---|---|---|
| `claude-sonnet-4-5` / `claude-sonnet-4-6` | DeepSeek V4 Flash (or OpenCode) | Text, reasoning |
| `claude-opus-4-7` | DeepSeek V4 Pro (or OpenCode) | Text, reasoning |
| Images (auto-routed) | **Gemini Flash 2.5** | OCR, image analysis, vision |

> **LLM provider choice:** You can use either **DeepSeek API** (Anthropic-compatible) or **OpenCode Go** (OpenAI-compatible, hosts DeepSeek models). The setup script lets you choose. OpenCode is tried first if both keys are present.

> Images are auto-detected and routed through a **pipeline**: Gemini Flash 2.5 describes the image → the description is sent to DeepSeek → DeepSeek generates the final response. No manual model switching needed.

### Gemini Flash 2.5 — Free tier

Google AI Studio offers a **generous free tier** for Gemini Flash 2.5:
- **1000 requests/day** for free
- **15 RPM** (requests per minute)
- No credit card required
- Get your API key at: https://aistudio.google.com/apikey

Supported image formats: JPEG, PNG, WEBP, HEIC, HEIF

> **Note:** Claude Desktop only accepts model names with the `claude-` prefix and a recognized suffix (e.g. `-sonnet-`, `-opus-`, `-haiku-`). Arbitrary model names are not allowed — the proxy handles the mapping transparently.

## Prerequisites

- Node.js v18+
- OpenSSL in PATH (on Windows: included in Git for Windows)
- A DeepSeek API key from https://platform.deepseek.com
- A Gemini API key from https://aistudio.google.com/apikey (free)
- Claude Desktop installed

## Installation

### 1. Clone the repo

```bash
git clone https://github.com/iannuz92/claude-deepseek-proxy.git
cd claude-deepseek-proxy
```

### 2. Configure the API keys

**🔧 Automated setup (recommended):**
Run the interactive setup script:

**Windows:**
```cmd
setup.bat
```

**Linux/macOS:**
```bash
chmod +x setup.sh
./setup.sh
```

The script will ask for your API keys, generate certificates, install the CA, configure Claude Desktop, and verify everything works.

> **Manual setup:** follow the steps below.

Copy `.env.example` to `.env` and fill in your keys:

```bash
cp .env.example .env    # Linux/macOS
copy .env.example .env  # Windows
```

Edit `.env`:

```env
DEEPSEEK_API_KEY=sk-...        # from https://platform.deepseek.com
GEMINI_API_KEY=...             # from https://aistudio.google.com/apikey (free tier)
```

### 3. Generate TLS certificates

Claude Desktop **requires HTTPS** for gateway connections. You need to generate a local CA and a server certificate, then install the CA in your system trust store.

**Windows:**
```powershell
powershell -ExecutionPolicy Bypass -File certs\generate-certs.ps1
```

**Linux/macOS:**
```bash
chmod +x certs/generate-certs.sh
./certs/generate-certs.sh
```

Certificates are saved in `certs/` (already in `.gitignore`).

### 4. Install the CA certificate

This step is **required**: Claude Desktop's sandbox strictly verifies the TLS chain. Without the CA installed, the connection is refused.

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

Restart Claude Desktop after installing the CA.

### 5. Enable Developer Mode in Claude Desktop

1. Open Claude Desktop (**do not sign in** — stay on the login screen)
2. Go to **Help → Troubleshooting**
3. Enable **Enable Developer Mode**

Without this option, third-party inference settings are ignored. A new **Developer** menu appears in the menu bar.

### 6. Configure third-party inference (models + gateway)

Go to **Developer → Configure third-party inference**. In the configuration window:

| Section | Setting | Value |
|---------|---------|-------|
| Connection | Inference provider | **Gateway** |
| Connection | Gateway base URL | `https://localhost:8877` |
| Connection | Gateway API key | `proxy-local-key` (or any value) |
| Connection → Models | Model ID | `claude-sonnet-4-5` |
| Connection → Models | Display name | `sonnet 4.5` |
| Connection → Models | Model ID | `claude-opus-4-7` |
| Connection → Models | Display name | `claude opus 4.7` |

Click **Apply locally** to save the configuration. Claude Desktop will relaunch.

> For images, just use the same `claude-sonnet-4-5` model — the proxy auto-detects images and routes them through the Gemini OCR pipeline.

### 7. (Alternative) Configure the gateway URL via file

If you prefer file-based configuration, create `developer_settings.json` in **both** directories:

| OS | Path |
|----|------|
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

### 8. Start the proxy

**Windows:**
```cmd
start.bat
```

**Linux/macOS:**
```bash
chmod +x start.sh
./start.sh
```

Or directly:
```bash
node proxy/server.js
```

### 9. Start Claude Desktop

Quit Claude Desktop completely (including from the tray icon), then relaunch it.  
Select one of the configured models and send a message.

## Image OCR pipeline

```
User uploads image in Claude Desktop
        │
        ▼
    Proxy detects image → routes to Gemini Flash 2.5
        │
        ▼
    Gemini describes the image (OCR, objects, colors, text...)
        │
        ▼
    Description injected into the request, sent to DeepSeek
        │
        ▼
    DeepSeek processes text + description → final response
```

No manual model switching — just use `claude-sonnet-4-5` for everything.

## Project structure

```
/
├── setup.bat               - Windows automated setup (interactive)
├── setup.sh                - Linux/macOS automated setup (interactive)
├── start.bat               - Windows quick launcher
├── start.sh                - Linux/macOS quick launcher
├── README.md
├── .env.example            - Environment variables template
├── proxy/
│   ├── server.js           - The proxy (DeepSeek / OpenCode + Gemini)
│   └── test-proxy.js       - Connectivity test script
├── certs/
│   ├── ca.cnf              - CA configuration
│   ├── server.cnf          - Server certificate configuration
│   ├── generate-certs.ps1  - Generate certificates (Windows)
│   ├── generate-certs.sh   - Generate certificates (Linux/macOS)
│   ├── install-ca.ps1      - Install CA in trust store (Windows)
│   └── install-ca.sh       - Install CA in trust store (Linux/macOS)
└── mcp-gemini-vision/      - MCP Gemini Vision extension
```

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `ERR_CERT_AUTHORITY_INVALID` | CA not installed | Run `install-ca.ps1` / `install-ca.sh` |
| `ERR_SSL_PROTOCOL_ERROR` | Proxy not running as HTTPS | Check that `server.js` uses `https.createServer` |
| "server is busy" loop | Probes not intercepted | Check that the proxy responds to `max_tokens=1` |
| Model not visible in Claude | Unrecognized model name | Use only `-sonnet-`, `-opus-`, `-haiku-` suffixes |
| Image upload 503 | Quick Entry shortcut bypasses gateway | Use drag & drop or + button in chat |
| Gemini 429 rate limit | Free tier limit reached | Wait or upgrade to paid tier |
| Empty content 400 | Gemini rate limited, no fallback | Proxy now handles gracefully |

## Technical notes

- **Why a CA chain?** Claude Desktop's sandbox strictly verifies TLS. A self-signed certificate without `CA:TRUE` in Basic Constraints is rejected.
- **Probe interception:** Claude Desktop sends requests with `max_tokens=1` to validate connectivity. The proxy responds locally without hitting the upstream.
- **Image pipeline:** Gemini Flash 2.5 is used for OCR/image analysis only. The text description is then fed to DeepSeek for the final response. This gives you DeepSeek's reasoning quality with Gemini's vision capabilities.
- **Port 8877:** Arbitrary — change it in `server.js` and in Claude Desktop settings.
- **Google AI free tier:** 1000 req/day, 15 RPM, no credit card. Get your key at https://aistudio.google.com/apikey
