param([Parameter(Mandatory=$true)][string]$Repository,[string]$Distribution='Ubuntu',[Parameter(Mandatory=$true)][string]$OwnerEmail)
& "$PSScriptRoot/Orbit.ps1" -Action install -Repository $Repository -Distribution $Distribution -OwnerEmail $OwnerEmail
