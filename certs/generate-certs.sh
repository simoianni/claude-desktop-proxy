#!/usr/bin/env bash
# Genera CA e certificato server per il proxy locale
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "Generazione CA..."
openssl genrsa -out ca-key.pem 2048
openssl req -new -x509 -days 3650 -key ca-key.pem -out ca-cert.pem -config ca.cnf

echo "Generazione chiave server..."
openssl genrsa -out server-key.pem 2048

echo "Generazione CSR server..."
openssl req -new -key server-key.pem -out server.csr -config server.cnf

echo "Firma certificato server con la CA..."
openssl x509 -req -days 3650 \
  -in server.csr \
  -CA ca-cert.pem -CAkey ca-key.pem -CAcreateserial \
  -out server-cert.pem \
  -extensions v3_ext -extfile server.cnf

rm -f server.csr ca-cert.srl

echo ""
echo "Certificati generati:"
echo "  ca-cert.pem      - Certificato CA (da installare nel sistema)"
echo "  ca-key.pem       - Chiave CA (tenere segreto)"
echo "  server-cert.pem  - Certificato server"
echo "  server-key.pem   - Chiave server"
echo ""
echo "Passo successivo: installa la CA con ./install-ca.sh"
