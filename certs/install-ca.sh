#!/usr/bin/env bash
# Installa il certificato CA nel trust store di sistema (Linux / macOS)
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
CA="$DIR/ca-cert.pem"  # generato da generate-certs.sh nella stessa cartella

if [ ! -f "$CA" ]; then
  echo "Errore: ca-cert.pem non trovato. Esegui prima ./generate-certs.sh"
  exit 1
fi

OS="$(uname -s)"

if [ "$OS" = "Darwin" ]; then
  echo "macOS: aggiunta CA al keychain di sistema..."
  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$CA"
  echo "CA installata. Riavvia Claude Desktop."

elif [ "$OS" = "Linux" ]; then
  if command -v update-ca-certificates &>/dev/null; then
    # Debian/Ubuntu
    sudo cp "$CA" /usr/local/share/ca-certificates/claude-proxy-ca.crt
    sudo update-ca-certificates
  elif command -v update-ca-trust &>/dev/null; then
    # RHEL/Fedora/Arch
    sudo cp "$CA" /etc/pki/ca-trust/source/anchors/claude-proxy-ca.pem
    sudo update-ca-trust extract
  else
    echo "Distro non riconosciuta. Copia manualmente $CA nel trust store."
    exit 1
  fi
  echo "CA installata. Riavvia Claude Desktop."

else
  echo "OS non supportato: $OS"
  exit 1
fi
