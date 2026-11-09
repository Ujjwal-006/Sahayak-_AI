$saasJob = Start-Process -FilePath "node" -ArgumentList "node_modules/tsx/dist/cli.mjs", "src/server.ts" -WorkingDirectory "$PSScriptRoot/saas-backend" -RedirectStandardOutput "$PSScriptRoot/saas.log" -RedirectStandardError "$PSScriptRoot/saas_err.log" -PassThru
$callJob = Start-Process -FilePath "node" -ArgumentList "node_modules/tsx/dist/cli.mjs", "index.ts" -WorkingDirectory "$PSScriptRoot/call-engine" -RedirectStandardOutput "$PSScriptRoot/call.log" -RedirectStandardError "$PSScriptRoot/call_err.log" -PassThru

Write-Host "Started SaaS (PID $($saasJob.Id)) and CallEngine (PID $($callJob.Id)). Waiting 4 seconds..."
Start-Sleep -Seconds 4

try {
  & node "$PSScriptRoot/call-engine/node_modules/tsx/dist/cli.mjs" "$PSScriptRoot/call-engine/test-backend.ts"
} finally {
  Write-Host "Stopping background servers..."
  Stop-Process -Id $saasJob.Id -Force -ErrorAction SilentlyContinue
  Stop-Process -Id $callJob.Id -Force -ErrorAction SilentlyContinue
  if (Test-Path "$PSScriptRoot/saas.log") { Get-Content "$PSScriptRoot/saas.log" }
  if (Test-Path "$PSScriptRoot/saas_err.log") { Get-Content "$PSScriptRoot/saas_err.log" }
  if (Test-Path "$PSScriptRoot/call.log") { Get-Content "$PSScriptRoot/call.log" }
  if (Test-Path "$PSScriptRoot/call_err.log") { Get-Content "$PSScriptRoot/call_err.log" }
  Write-Host "Done."
}
