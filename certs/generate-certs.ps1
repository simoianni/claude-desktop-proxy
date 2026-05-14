# Genera CA e certificato server per il proxy locale (Windows)
# Richiede OpenSSL nel PATH (es. installato con Git for Windows o standalone)
Set-StrictMode -Off
$ErrorActionPreference = "Stop"

$DIR = $PSScriptRoot

Write-Host "Generazione CA..."
openssl genrsa -out "$DIR\ca-key.pem" 2048
openssl req -new -x509 -days 3650 -key "$DIR\ca-key.pem" -out "$DIR\ca-cert.pem" -config "$DIR\ca.cnf"

Write-Host "Generazione chiave server..."
openssl genrsa -out "$DIR\server-key.pem" 2048

Write-Host "Generazione CSR server..."
openssl req -new -key "$DIR\server-key.pem" -out "$DIR\server.csr" -config "$DIR\server.cnf"

Write-Host "Firma certificato server con la CA..."
openssl x509 -req -days 3650 `
  -in "$DIR\server.csr" `
  -CA "$DIR\ca-cert.pem" -CAkey "$DIR\ca-key.pem" -CAcreateserial `
  -out "$DIR\server-cert.pem" `
  -extensions v3_ext -extfile "$DIR\server.cnf"

Remove-Item -Force -ErrorAction SilentlyContinue "$DIR\server.csr", "$DIR\ca-cert.srl"

Write-Host ""
Write-Host "Certificati generati:"
Write-Host "  ca-cert.pem      - Certificato CA (da installare nel sistema)"
Write-Host "  ca-key.pem       - Chiave CA (tenere segreto)"
Write-Host "  server-cert.pem  - Certificato server"
Write-Host "  server-key.pem   - Chiave server"
Write-Host ""
Write-Host "Passo successivo: esegui install-ca.ps1 per installare la CA"
