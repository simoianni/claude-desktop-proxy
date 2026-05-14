# Remove old self-signed cert
Get-ChildItem 'Cert:\CurrentUser\Root' | Where-Object { $_.Thumbprint -eq '16E0D38BA7E342AA7492A0DD7DD614DF54BA6FFA' } | Remove-Item -Force -ErrorAction SilentlyContinue

# Import new CA cert
$caCert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2("$PSScriptRoot\ca-cert.pem")
$store = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', 'CurrentUser')
$store.Open('ReadWrite')
$store.Add($caCert)
$store.Close()

Write-Output "CA cert installed: $($caCert.Thumbprint)"
Write-Output "Subject: $($caCert.Subject)"
