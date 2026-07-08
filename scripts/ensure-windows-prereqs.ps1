# Tự cài Node.js, Docker Desktop, Python qua winget (Windows) trước khi chạy setup.
param(
    [switch]$Quiet
)

$ErrorActionPreference = 'Continue'

function Write-SetupMsg {
    param([string]$Text, [string]$Color = 'White')
    if (-not $Quiet) { Write-Host $Text -ForegroundColor $Color }
}

function Test-Command {
    param([string]$Name)
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    $null = Get-Command $Name -ErrorAction SilentlyContinue
    $ok = $?
    $ErrorActionPreference = $old
    return $ok
}

function Refresh-SessionPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user"
}

function Invoke-WingetInstall {
    param(
        [string]$Id,
        [string]$Label
    )
    Write-SetupMsg "  winget install $Label ($Id)..." 'Yellow'
    $args = @(
        'install', '--id', $Id,
        '-e',
        '--accept-package-agreements',
        '--accept-source-agreements',
        '--disable-interactivity'
    )
    $proc = Start-Process -FilePath 'winget' -ArgumentList $args -Wait -PassThru -NoNewWindow
    if ($proc.ExitCode -in 0, -1978335189, -1978335188) {
        # 0 = OK; negative codes = already installed / no upgrade
        Write-SetupMsg "  $Label OK" 'Green'
        return $true
    }
    Write-SetupMsg "  winget exit $($proc.ExitCode) cho $Label" 'Red'
    return $false
}

function Ensure-DockerCli {
    if (Test-Command 'docker') { return $true }

    $candidates = @(
        "$env:ProgramFiles\Docker\Docker\resources\bin\docker.exe",
        "${env:ProgramFiles(x86)}\Docker\Docker\resources\bin\docker.exe"
    )
    foreach ($exe in $candidates) {
        if (Test-Path $exe) {
            $dir = Split-Path $exe -Parent
            if ($env:Path -notlike "*$dir*") {
                $env:Path = "$dir;$env:Path"
            }
            if (Test-Command 'docker') { return $true }
        }
    }

    $desktop = "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $desktop) {
        Write-SetupMsg '  Khoi dong Docker Desktop (lan dau co the mat 1-2 phut)...' 'Yellow'
        Start-Process -FilePath $desktop -ErrorAction SilentlyContinue | Out-Null
        for ($i = 0; $i -lt 24; $i++) {
            Start-Sleep -Seconds 5
            Refresh-SessionPath
            if (Test-Command 'docker') {
                $null = docker info 2>&1
                if ($LASTEXITCODE -eq 0) {
                    Write-SetupMsg '  Docker daemon san sang' 'Green'
                    return $true
                }
            }
        }
        Write-SetupMsg '  Docker da cai nhung daemon chua san sang — mo Docker Desktop, doi icon xanh roi chay lai setup.bat' 'Yellow'
        return $false
    }
    return $false
}

Write-SetupMsg ''
Write-SetupMsg '--- Kiem tra Node.js / Docker / Python (Windows) ---' 'Cyan'

if (-not $IsWindows) {
    Write-SetupMsg 'SETUP chi ho tro Windows.' 'Red'
    exit 1
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) {
    Write-SetupMsg 'SETUP CAN QUYEN ADMINISTRATOR.' 'Red'
    Write-SetupMsg 'Chuot phai setup.bat -> Run as administrator' 'Yellow'
    exit 1
}

if (-not (Test-Command 'winget')) {
    Write-SetupMsg 'Khong tim thay winget.' 'Red'
    Write-SetupMsg 'Cai "App Installer" tu Microsoft Store, hoac cap nhat Windows 10/11.' 'Yellow'
    Write-SetupMsg 'Hoac cai thu cong: Node.js 20+, Docker Desktop, Python 3.12' 'Yellow'
    exit 1
}

$packages = @(
    @{ Id = 'OpenJS.NodeJS.LTS'; Label = 'Node.js LTS'; Cmd = 'node' },
    @{ Id = 'Docker.DockerDesktop'; Label = 'Docker Desktop'; Cmd = 'docker' },
    @{ Id = 'Python.Python.3.12'; Label = 'Python 3.12'; Cmd = 'python' }
)

$installedAny = $false
foreach ($pkg in $packages) {
    Refresh-SessionPath
    if (Test-Command $pkg.Cmd) {
        Write-SetupMsg "  $($pkg.Label): da co" 'DarkGray'
        continue
    }
    if ($pkg.Cmd -eq 'python' -and (Test-Command 'python3')) {
        Write-SetupMsg "  $($pkg.Label): da co (python3)" 'DarkGray'
        continue
    }
    if ($pkg.Cmd -eq 'python' -and (Test-Command 'py')) {
        Write-SetupMsg "  $($pkg.Label): da co (py)" 'DarkGray'
        continue
    }

    Write-SetupMsg "Thieu $($pkg.Label) — tu dong cai bang winget..." 'Yellow'
    if (Invoke-WingetInstall -Id $pkg.Id -Label $pkg.Label) {
        $installedAny = $true
    }
}

if ($installedAny) {
    Write-SetupMsg 'Cap nhat PATH sau khi cai...' 'DarkGray'
    Refresh-SessionPath
    Start-Sleep -Seconds 2
}

Refresh-SessionPath

$missing = @()
if (-not (Test-Command 'node')) { $missing += 'Node.js' }
if (-not (Ensure-DockerCli) -and -not (Test-Command 'docker')) { $missing += 'Docker' }
$hasPython = (Test-Command 'python') -or (Test-Command 'python3') -or (Test-Command 'py')
if (-not $hasPython) { $missing += 'Python' }

if ($missing.Count -gt 0) {
    Write-SetupMsg ''
    Write-SetupMsg "Van thieu: $($missing -join ', ')" 'Red'
    if ($missing -contains 'Docker') {
        Write-SetupMsg 'Docker Desktop: mo ung dung, bat WSL2/Hyper-V neu duoc hoi, doi daemon chay xong.' 'Yellow'
    }
    if ($installedAny) {
        Write-SetupMsg 'Thu dong cua so CMD/PowerShell roi chay lai setup.bat (PATH moi).' 'Yellow'
    }
    exit 1
}

$nodeVer = (node -v 2>$null)
$dockerVer = (docker --version 2>$null)
$pyVer = if (Test-Command 'python') { python --version 2>$null }
        elseif (Test-Command 'python3') { python3 --version 2>$null }
        else { py --version 2>$null }

Write-SetupMsg "  Node $nodeVer | $dockerVer | $pyVer" 'Green'
Write-SetupMsg ''
exit 0