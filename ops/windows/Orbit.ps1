[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][ValidateSet('install','start','stop','restart','update','backup','restore','status','login-codex','login-gemini','install-cli')][string]$Action,
 [Parameter(Mandatory=$true)][ValidatePattern('^/home/[^\r\n]+$')][string]$Repository,
 [ValidatePattern('^[a-zA-Z0-9._-]+$')][string]$Distribution='Ubuntu',
 [string]$OwnerEmail='',
 [string]$BackupId=''
)
$ErrorActionPreference='Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Run this entry point on Windows with WSL2.' }
if ([Environment]::OSVersion.Version.Build -lt 19045) { throw 'Windows 10 22H2 build 19045 or newer is required. Check current Docker Desktop support before installation.' }
if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { throw 'Install WSL2 and Ubuntu, then enable Docker Desktop WSL integration.' }
# Argument arrays only: no Invoke-Expression and no credentials in command arguments.
$Bridge="$Repository/ops/windows/bridge.sh"
$Arguments=@('--distribution',$Distribution,'--exec','bash',$Bridge,$Action,$Repository)
if ($OwnerEmail) { $Arguments+=@('--email',$OwnerEmail) }
if ($BackupId) { $Arguments+=@('--backup',$BackupId) }
& wsl.exe @Arguments
if ($LASTEXITCODE -ne 0) { throw "ORBIT $Action failed (exit $LASTEXITCODE)." }
