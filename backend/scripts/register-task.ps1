# Register the Zoom Notes sync scheduled task (every 30 minutes, logged-on only).
# Run from an elevated or same-user PowerShell session:
#   powershell -NoProfile -File .\scripts\register-task.ps1

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$RunPs1 = Join-Path $Root "run.ps1"
if (-not (Test-Path -LiteralPath $RunPs1)) {
    throw "run.ps1 not found at $RunPs1"
}

$TaskName = if ($env:ZOOM_TASK_NAME) { $env:ZOOM_TASK_NAME } else { "ZoomNotesSync" }
$PsExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$Arg = "-NoProfile -ExecutionPolicy Bypass -File `"$RunPs1`""

$Action = New-ScheduledTaskAction -Execute $PsExe -Argument $Arg -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 30) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
$Settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries
# Interactive / logged-on user required for SSO re-auth UI.
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger `
    -Settings $Settings -Principal $Principal -Force | Out-Null

Write-Host "Registered task '$TaskName'."
Write-Host "  Action: $PsExe $Arg"
Write-Host "  Manage: Get-ScheduledTask -TaskName $TaskName"
Write-Host "  Run now: Start-ScheduledTask -TaskName $TaskName"
Write-Host "  Remove: Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false"
