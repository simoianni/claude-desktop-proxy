# Genera CA e certificato server per il proxy locale (Windows)
# Compatibile con PowerShell 5.1 / .NET Framework 4.x - nessuna dipendenza da OpenSSL
$ErrorActionPreference = "Stop"

$DIR = $PSScriptRoot

# Encode ASN.1 length field
function Asn1Len($len) {
    if ($len -lt 0x80) { return [byte[]]@($len) }
    $bytes = [System.Collections.Generic.List[byte]]::new()
    $tmp = $len
    while ($tmp -gt 0) { $bytes.Insert(0, [byte]($tmp -band 0xFF)); $tmp = $tmp -shr 8 }
    $bytes.Insert(0, [byte](0x80 -bor $bytes.Count))
    return $bytes.ToArray()
}

# Wrap DER bytes with tag+length
function Asn1Tag($tag, [byte[]]$data) {
    return [byte[]]@($tag) + (Asn1Len $data.Length) + $data
}

# Encode positive integer (prepend 0x00 if high bit set)
function Asn1Int([byte[]]$data) {
    if ($data[0] -band 0x80) { $data = [byte[]]@(0x00) + $data }
    return Asn1Tag 0x02 $data
}

# Build PKCS#1 RSAPrivateKey DER from RSAParameters
function Export-RsaPrivateKeyDer($params) {
    $seq = `
        (Asn1Int @(0x00)) +                        # version = 0
        (Asn1Int $params.Modulus) +
        (Asn1Int $params.Exponent) +
        (Asn1Int $params.D) +
        (Asn1Int $params.P) +
        (Asn1Int $params.Q) +
        (Asn1Int $params.DP) +
        (Asn1Int $params.DQ) +
        (Asn1Int $params.InverseQ)
    return Asn1Tag 0x30 $seq
}

# Export certificate as PEM
function Export-CertPem($cert) {
    $der = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
    $b64 = [Convert]::ToBase64String($der, [Base64FormattingOptions]::InsertLineBreaks)
    return "-----BEGIN CERTIFICATE-----`n$b64`n-----END CERTIFICATE-----"
}

# Create RSA key via RSACryptoServiceProvider (guaranteed on .NET Fx)
function New-RsaKey($bits) {
    $csp = [System.Security.Cryptography.RSACryptoServiceProvider]::new($bits)
    return $csp
}

Write-Host "Generazione CA..."

$caKey  = New-RsaKey 2048
$caReq  = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
    "CN=Claude-DS Proxy CA, O=Local",
    $caKey,
    [System.Security.Cryptography.HashAlgorithmName]::SHA256,
    [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
)
$caReq.CertificateExtensions.Add(
    [System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true, $false, 0, $true)
)
$caReq.CertificateExtensions.Add(
    [System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(
        [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign -bor
        [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::CrlSign, $true
    )
)
$caReq.CertificateExtensions.Add(
    [System.Security.Cryptography.X509Certificates.X509SubjectKeyIdentifierExtension]::new($caReq.PublicKey, $false)
)

$notBefore = [DateTimeOffset]::UtcNow.AddDays(-1)
$notAfter  = [DateTimeOffset]::UtcNow.AddDays(3650)
$caCert    = $caReq.CreateSelfSigned($notBefore, $notAfter)

Write-Host "Generazione chiave e certificato server..."

$srvKey = New-RsaKey 2048
$srvReq = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
    "CN=localhost",
    $srvKey,
    [System.Security.Cryptography.HashAlgorithmName]::SHA256,
    [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
)
$srvReq.CertificateExtensions.Add(
    [System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $false)
)
$srvReq.CertificateExtensions.Add(
    [System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(
        [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor
        [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment, $true
    )
)
$ekuOids = [System.Security.Cryptography.OidCollection]::new()
$ekuOids.Add([System.Security.Cryptography.Oid]::new("1.3.6.1.5.5.7.3.1")) | Out-Null
$srvReq.CertificateExtensions.Add(
    [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($ekuOids, $false)
)
$san = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
$san.AddDnsName("localhost")
$san.AddIpAddress([System.Net.IPAddress]::Parse("127.0.0.1"))
$san.AddIpAddress([System.Net.IPAddress]::Parse("172.16.10.1"))
$srvReq.CertificateExtensions.Add($san.Build())

$rng    = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$serial = [byte[]]::new(16)
$rng.GetBytes($serial)
$rng.Dispose()

$srvCert = $srvReq.Create($caCert, $notBefore, $notAfter, $serial)

Write-Host "Esportazione PEM..."

$caKeyDer  = Export-RsaPrivateKeyDer ($caKey.ExportParameters($true))
$srvKeyDer = Export-RsaPrivateKeyDer ($srvKey.ExportParameters($true))

$caKeyB64  = [Convert]::ToBase64String($caKeyDer,  [Base64FormattingOptions]::InsertLineBreaks)
$srvKeyB64 = [Convert]::ToBase64String($srvKeyDer, [Base64FormattingOptions]::InsertLineBreaks)

"-----BEGIN RSA PRIVATE KEY-----`n$caKeyB64`n-----END RSA PRIVATE KEY-----"  | Set-Content -Encoding utf8 "$DIR\ca-key.pem"
"-----BEGIN RSA PRIVATE KEY-----`n$srvKeyB64`n-----END RSA PRIVATE KEY-----" | Set-Content -Encoding utf8 "$DIR\server-key.pem"
Export-CertPem $caCert   | Set-Content -Encoding utf8 "$DIR\ca-cert.pem"
Export-CertPem $srvCert  | Set-Content -Encoding utf8 "$DIR\server-cert.pem"

Write-Host ""
Write-Host "Certificati generati:"
Write-Host "  ca-cert.pem      - Certificato CA (da installare nel sistema)"
Write-Host "  ca-key.pem       - Chiave CA (tenere segreto)"
Write-Host "  server-cert.pem  - Certificato server"
Write-Host "  server-key.pem   - Chiave server"
