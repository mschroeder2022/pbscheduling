# Registers the pbscheduling agent to start automatically at user logon and keep
# running (auto-restart on crash). Runs in the INTERACTIVE session so the Picklr
# scraper can use headed Chrome (a session-0 Windows service cannot render one).
#
# Run from an elevated PowerShell:  powershell -ExecutionPolicy Bypass -File scripts\install-startup.ps1
# Uninstall:                        powershell -ExecutionPolicy Bypass -File scripts\uninstall-startup.ps1

$ErrorActionPreference = 'Stop'
$TaskName  = 'PBSchedulingAgent'
$ProjectDir = Split-Path -Parent $PSScriptRoot
$Vbs       = Join-Path $ProjectDir 'scripts\launch-hidden.vbs'

if (-not (Test-Path $Vbs)) { throw "Launcher not found: $Vbs" }

# Action: run the hidden VBS launcher via wscript (it spawns node with no console).
$Action = New-ScheduledTaskAction -Execute 'wscript.exe' `
  -Argument "`"$Vbs`"" -WorkingDirectory $ProjectDir

# Trigger: at logon of the CURRENT user (interactive session => headed Chrome works).
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Run as the current user, in the interactive session (not SYSTEM/session 0).
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive -RunLevel Limited

# Settings: never time out, restart on failure, only one instance, run on battery.
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew

# Replace any existing task with the same name.
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger `
  -Principal $Principal -Settings $Settings `
  -Description 'Pickleball scheduling agent (calendar + Picklr reservation checks). Starts at logon, runs resident.' | Out-Null

Write-Host "Registered scheduled task '$TaskName' (runs at logon of $env:USERNAME)."
Write-Host "Start it now with:  Start-ScheduledTask -TaskName $TaskName"
Write-Host ""
Write-Host "NOTE: This trigger fires when you LOG ON. For a fully unattended start after"
Write-Host "an unattended reboot (no one at the keyboard), enable Windows auto-logon so the"
Write-Host "desktop session starts on boot. Headed Chrome (required by the Picklr scraper)"
Write-Host "cannot run without a desktop session, which is why this is a logon task, not a service."
