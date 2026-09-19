param([switch]$ShowWindow, [string]$ExecutablePath = '')
$ErrorActionPreference = 'Stop'
$config = Get-Content -Raw -LiteralPath 'package.json' | ConvertFrom-Json
if (-not $ExecutablePath) { $ExecutablePath = Join-Path $config.build.directories.output 'win-unpacked/Career Assistant.exe' }
$executable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$root = (Resolve-Path -LiteralPath '.test-data').Path
$data = Join-Path $root ('packaged-offline-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $data | Out-Null
$names = @('CAREER_TEST_MODE','CAREER_TEST_DATA','CAREER_DEV_URL','ELECTRON_RUN_AS_NODE','NODE_OPTIONS')
$saved = @{}
foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    $env:CAREER_TEST_MODE = '1'
    $env:CAREER_TEST_DATA = $data
    $env:CAREER_DEV_URL = 'http://127.0.0.1:5173'
    [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', $null, 'Process')
    [Environment]::SetEnvironmentVariable('NODE_OPTIONS', $null, 'Process')
    for ($run = 1; $run -le 2; $run++) {
        if (-not $ShowWindow) { throw 'Use -ShowWindow after explicitly authorizing the visible interactive test window.' }
        $launcher = Start-Process -FilePath $executable -PassThru -WindowStyle Normal
        $owned = [System.Collections.Generic.HashSet[int]]::new()
        [void]$owned.Add($launcher.Id)
        $deadline = (Get-Date).AddSeconds(90)
        $window = $null
        do {
            $processes = @(Get-CimInstance Win32_Process)
            foreach ($process in $processes) {
                if ($owned.Contains([int]$process.ParentProcessId)) { [void]$owned.Add([int]$process.ProcessId) }
            }
            foreach ($id in $owned) {
                $candidate = Get-Process -Id $id -ErrorAction SilentlyContinue
                if ($candidate -and $candidate.MainWindowHandle -ne 0 -and $candidate.MainWindowTitle -like 'Career Assistant*') { $window = $candidate; break }
            }
            if (-not $window) { Start-Sleep -Milliseconds 400 }
        } until ($window -or (Get-Date) -gt $deadline)
        if (-not $window) { throw "No application window; owned PIDs: $($owned -join ','). No force termination performed." }
        if (-not (Test-Path -LiteralPath (Join-Path $data 'workspace.sqlite'))) { throw 'Isolated database missing' }
        if (-not $window.CloseMainWindow()) { throw "Could not request normal close for PID $($window.Id)" }
        if (-not $window.WaitForExit(30000)) { throw "Normal close timed out for PID $($window.Id); no force termination performed." }
        if (-not $launcher.WaitForExit(30000)) { throw 'Portable launcher did not exit normally' }
        if ($launcher.ExitCode -ne 0) { throw "Launch failed: $($launcher.ExitCode)" }
        Write-Output "Packaged offline startup / isolated DB / normal close PASS (run $run)"
    }
    Write-Output "Isolated test data: $data"
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
}

