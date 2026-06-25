# Claude Desktop → DeepSeek / Gemini Proxy

A local HTTPS proxy that lets **Claude Desktop** use **DeepSeek** and **Google Gemini Flash 2.5** APIs instead of Anthropic's official API — for a fraction of the cost.

```
Claude Desktop → HTTPS (127.0.0.1:8877) → Local proxy ─┬─→ DeepSeek API  (text & reasoning)
                                                        └─→ Gemini Flash  (images & OCR)
```

## What you need

| Requirement | Notes |
|---|---|
| **Node.js v18+** | The setup script installs it automatically if missing (Windows) |
| **DeepSeek API key** | https://platform.deepseek.com — free credits on signup |
| **Gemini API key** | https://aistudio.google.com/apikey — 1000 req/day free, no credit card |
| **Claude Desktop** | Already installed |

> **Alternative LLM:** instead of DeepSeek you can use **OpenCode Go** (opencode.ai). The setup script lets you choose.

---

## Quick start

### Windows

```cmd
setup.bat
```

Double-click `setup.bat` or run it from a terminal. The script will:

1. Install Node.js automatically if not found (via winget)
2. Ask for your API keys and create `.env`
3. Generate TLS certificates (no OpenSSL needed — pure PowerShell)
4. Install the CA certificate in the Windows trust store
5. Write Claude Desktop config files
6. **Start the proxy** so Claude Desktop can connect immediately
7. Walk you through the two manual steps in Claude Desktop
8. Optionally register an auto-start task at Windows login

### Linux / macOS

```bash
chmod +x setup.sh
./setup.sh
```

Same flow — the script handles everything interactively.

---

## Model mapping

| Model in Claude Desktop | Backend | Use for |
|---|---|---|
| `claude-sonnet-4-5` | DeepSeek V4 Flash (or OpenCode) | Text, reasoning, chat |
| `claude-opus-4-7` | DeepSeek V4 Pro (or OpenCode) | Complex reasoning |
| Images (auto-routed) | **Gemini Flash 2.5** | OCR, image analysis, vision |

Images are auto-detected — no manual model switching needed. Just use `claude-sonnet-4-5` for everything.

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
git clone https://github.com/iannuz92/claude-deepseek-proxy.git
cd claude-deepseek-proxy
cp .env.example .env    # Linux/macOS
copy .env.example .env  # Windows
```

Edit `.env`:
```env
DEEPSEEK_API_KEY=sk-...   # https://platform.deepseek.com
GEMINI_API_KEY=...         # https://aistudio.google.com/apikey
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
