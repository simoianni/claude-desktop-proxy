# Claude Desktop → DeepSeek Proxy

A local HTTPS proxy that lets **Claude Desktop** use the **DeepSeek** API instead of Anthropic's official API.

## How it works

```
Claude Desktop → HTTPS (127.0.0.1:8877) → Local proxy → DeepSeek API
```

The proxy:
- Intercepts Claude Desktop validation probes (`max_tokens=1`) and responds locally
- Maps Claude model names → DeepSeek model names
- Restores the original model name in the response
- Handles both streaming (SSE) and non-streaming requests

## Model mapping

| Claude Desktop model | DeepSeek model |
|----------------------|----------------|
| `claude-sonnet-4-5`  | `deepseek-v4-flash` |
| `claude-opus-4-7`    | `deepseek-v4-pro`   |

> **Note:** Claude Desktop only accepts model names with the `claude-` prefix and a recognized suffix (e.g. `-sonnet-`, `-opus-`, `-haiku-`). Arbitrary model names are not allowed — the proxy handles the mapping transparently.

## Prerequisites

- Node.js v18+
- OpenSSL in PATH (on Windows: included in Git for Windows)
- A DeepSeek API key from https://platform.deepseek.com
- Claude Desktop installed

## Installation

### 1. Clone the repo

```bash
git clone https://github.com/yourusername/claude-deepseek-proxy.git
cd claude-deepseek-proxy
```

### 2. Configure the API key

Copy `.env.example` to `.env` and fill in your key:

```bash
cp .env.example .env    # Linux/macOS
copy .env.example .env  # Windows
```

Edit `.env`:

```env
DEEPSEEK_API_KEY=sk-...   # from https://platform.deepseek.com
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

1. Open Claude Desktop
2. Go to **Help → Troubleshooting**
3. Enable **Enable Developer Mode**

Without this option, gateway settings are ignored.

### 6. Configure Claude Desktop — Identity & Models (UI)

In Claude Desktop **Settings → Identity & Models**, configure the model list as follows.

**Model list** (first entry is the picker default):

| Field | Value |
|-------|-------|
| Model ID | `claude-sonnet-4-5` |
| Display name | `sonnet 4.5` |

| Field | Value |
|-------|-------|
| Model ID | `claude-opus-4-7` |
| Display name | `claude opus 4.7` |

> Leave **Offer 1M-context variant** off unless DeepSeek actually serves an extended context window for that model.

### 7. Start the proxy

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
node server.js
```

### 8. Start Claude Desktop

Quit Claude Desktop completely (including from the tray icon), then relaunch it.  
Select one of the configured models and send a message.

## Project structure

```
/
├── certs/
│   ├── ca.cnf              - CA configuration
│   ├── server.cnf          - Server certificate configuration
│   ├── generate-certs.ps1  - Generate certificates (Windows)
│   ├── generate-certs.sh   - Generate certificates (Linux/macOS)
│   ├── install-ca.ps1      - Install CA in trust store (Windows)
│   └── install-ca.sh       - Install CA in trust store (Linux/macOS)
├── server.js               - The proxy
├── start.bat               - Windows launcher
├── start.sh                - Linux/macOS launcher
├── .env.example            - Environment variables template
└── README.md
```

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `ERR_CERT_AUTHORITY_INVALID` | CA not installed | Run `install-ca.ps1` / `install-ca.sh` |
| `ERR_SSL_PROTOCOL_ERROR` | Proxy not running as HTTPS | Check that `server.js` uses `https.createServer` |
| "server is busy" loop | Probes not intercepted | Check that the proxy responds to `max_tokens=1` |
| Model not visible in Claude | Unrecognized model name | Use only `-sonnet-`, `-opus-`, `-haiku-` suffixes |

## Technical notes

- **Why a CA chain?** Claude Desktop's sandbox strictly verifies TLS. A self-signed certificate without `CA:TRUE` in Basic Constraints is rejected.
- **Probe interception:** Claude Desktop sends requests with `max_tokens=1` to validate connectivity. The proxy responds locally without hitting the upstream.
- **Port 8877:** Arbitrary — change it in `server.js` and in Claude Desktop settings.