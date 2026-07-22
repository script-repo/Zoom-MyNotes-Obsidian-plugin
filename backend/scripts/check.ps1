# Local quality gate: unit tests (+ ruff if installed).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location -LiteralPath $Root

$Py = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $Py)) { $Py = "python" }

Write-Host "== pytest =="
& $Py -m pytest
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$Ruff = Join-Path $Root ".venv\Scripts\ruff.exe"
if (Test-Path -LiteralPath $Ruff) {
    Write-Host "== ruff check =="
    & $Ruff check .
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
    Write-Host "ruff not installed (optional): pip install ruff"
}

Write-Host "OK"
exit 0
