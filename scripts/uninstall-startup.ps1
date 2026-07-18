# Removes the pbscheduling agent scheduled task.
$ErrorActionPreference = 'Stop'
$TaskName = 'PBSchedulingAgent'
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed scheduled task '$TaskName'."
} else {
  Write-Host "No scheduled task named '$TaskName' found."
}
