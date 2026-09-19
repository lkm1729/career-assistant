param([switch]$ShowWindow, [string]$ResumeTestDirectory = '')
$ErrorActionPreference='Stop'
if(-not $ShowWindow){throw 'Explicit visible-window approval is required (-ShowWindow).'}
$root=(Resolve-Path -LiteralPath '.').Path
$config=Get-Content -Raw -LiteralPath 'package.json' | ConvertFrom-Json
$setup=(Resolve-Path -LiteralPath (Join-Path $config.build.directories.output ('Career-Assistant-'+$config.version+'-Setup-x64.exe'))).Path
$work=if($ResumeTestDirectory){(Resolve-Path -LiteralPath $ResumeTestDirectory).Path}else{Join-Path $root ('.test-data\p14-install-'+[guid]::NewGuid().ToString('N'))}
$target=[IO.Path]::GetFullPath((Join-Path $work 'Career Assistant'))
$data=[IO.Path]::GetFullPath((Join-Path $work 'isolated-data'))
foreach($p in @($work,$target,$data)){if(-not $p.StartsWith($root+'\.test-data\',[StringComparison]::OrdinalIgnoreCase)){throw 'Path escaped test workspace'}}
$installed=@(Get-ItemProperty HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*,HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* -ErrorAction SilentlyContinue | Where-Object {$_.DisplayName -like 'Career Assistant*'})
function RegistryTarget($registration) {
    if($registration.UninstallString -notmatch '^"([^"]+\\Uninstall Career Assistant\.exe)"'){throw 'Unrecognized uninstall registration; refuse to modify it'}
    return [IO.Path]::GetFullPath((Split-Path -Parent $Matches[1])).TrimEnd('\')
}
if($installed.Count){
    if(-not $ResumeTestDirectory -or $installed.Count -ne 1 -or (RegistryTarget $installed[0]) -ne $target.TrimEnd('\')){throw 'An existing installation is registered. Refusing to overwrite it; use a clean machine instead.'}
}
if(Get-Process -Name 'Career Assistant' -ErrorAction SilentlyContinue){throw 'Career Assistant is running. Close it yourself before installation tests; no process was terminated.'}
New-Item -ItemType Directory -Path $data -Force | Out-Null
Set-Content -LiteralPath (Join-Path $data 'preserve-user-data.txt') -Value 'P14 fake data preservation sentinel'
function Install-TestPackage {
    if(Get-Process -Name 'Career Assistant' -ErrorAction SilentlyContinue){throw 'App is running; aborting install test'}
    # /D is NSIS syntax, must be last, and not quoted internally even if the path has spaces.
    $p=Start-Process -FilePath $setup -ArgumentList @('/S',('/D='+$target)) -PassThru -WindowStyle Hidden
    if(-not $p.WaitForExit(180000)){throw 'Installer timed out; no process termination or cleanup attempted'}
    if($p.ExitCode -ne 0){throw "Installer failed: $($p.ExitCode)"}
    if(-not (Test-Path -LiteralPath (Join-Path $target 'Career Assistant.exe'))){throw 'Installed EXE missing'}
    $reg=@(Get-ItemProperty HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* -ErrorAction SilentlyContinue | Where-Object {$_.DisplayName -like 'Career Assistant*'})
    if($reg.Count -ne 1){throw 'Expected one per-user uninstall registration'}
    if((RegistryTarget $reg[0]) -ne $target.TrimEnd('\')){throw 'Installer used unexpected target. Refusing cleanup.'}
    if($reg[0].DisplayVersion -ne $config.version){throw 'Registered version mismatch'}
}
$envNames=@('CAREER_TEST_MODE','CAREER_TEST_DATA','CAREER_DEV_URL','ELECTRON_RUN_AS_NODE','NODE_OPTIONS','PATH')
$saved=@{};foreach($n in $envNames){$saved[$n]=[Environment]::GetEnvironmentVariable($n,'Process')}
try {
    Install-TestPackage
    $exe=Join-Path $target 'Career Assistant.exe'
    $env:CAREER_TEST_MODE='1';$env:CAREER_TEST_DATA=$data
    $env:CAREER_DEV_URL='http://127.0.0.1:5173'
    [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE',$null,'Process')
    [Environment]::SetEnvironmentVariable('NODE_OPTIONS',$null,'Process')
    $env:PATH="$env:SystemRoot\System32;$env:SystemRoot\System32\WindowsPowerShell\v1.0"
    if(Get-Command node,npm,python -ErrorAction SilentlyContinue){throw 'Developer runtime still on test PATH'}
    for($run=1;$run -le 2;$run++){
        $p=Start-Process -FilePath $exe -PassThru -WindowStyle Normal
        $deadline=(Get-Date).AddSeconds(60)
        do{$p.Refresh();if($p.HasExited){throw 'Installed app exited before creating a window'};if($p.MainWindowHandle -ne 0){break};Start-Sleep -Milliseconds 200}while((Get-Date)-lt $deadline)
        if($p.MainWindowHandle -eq 0){throw 'No installed application window; no forced cleanup'}
        if($run -eq 1){
            $blocked=Start-Process -FilePath $setup -ArgumentList @('/S',('/D='+$target)) -PassThru -WindowStyle Hidden
            if(-not $blocked.WaitForExit(30000)){throw 'Running-app installer guard timed out'}
            if($blocked.ExitCode -ne 2){throw 'Installer did not refuse a running app'}
            $p.Refresh();if($p.HasExited){throw 'Installer terminated the active test app'}
            Write-Output 'Installer running-app guard PASS: exit 2, application not terminated'
        }
        if(-not $p.CloseMainWindow()){throw 'Normal window close rejected'}

        if(-not $p.WaitForExit(30000)){throw 'Normal close timed out; no force termination'}
        if($p.ExitCode -ne 0){throw 'Installed app exit code was not zero'}
        $db=Join-Path $data 'workspace.sqlite';if(-not (Test-Path -LiteralPath $db)){throw 'Isolated DB missing'}
        if($run -eq 1){
            $before=(Get-FileHash -LiteralPath $db).Hash
            Install-TestPackage
            if((Get-FileHash -LiteralPath $db).Hash -ne $before){throw 'Reinstall modified isolated database'}
            Write-Output 'Per-user install and overwrite/reinstall PASS; existing isolated SQLite unchanged'
        }
        Write-Output "Installed EXE with developer tools removed from PATH / normal close PASS (run $run)"
    }
    $before=(Get-FileHash -LiteralPath $db).Hash
    $uninstaller=(Resolve-Path -LiteralPath (Join-Path $target 'Uninstall Career Assistant.exe')).Path
    if(-not $uninstaller.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Uninstaller escaped verified test install directory'}
    $p=Start-Process -FilePath $uninstaller -ArgumentList '/S' -PassThru -WindowStyle Hidden
    if(-not $p.WaitForExit(120000)){throw 'Uninstaller timed out; no forced cleanup'}
    if($p.ExitCode -ne 0){throw "Uninstaller failed: $($p.ExitCode)"}
    $deadline=(Get-Date).AddSeconds(60)
    while((Test-Path -LiteralPath $exe) -and (Get-Date)-lt $deadline){Start-Sleep -Milliseconds 300}
    if(Test-Path -LiteralPath $exe){throw 'Test installation not removed'}
    if((Get-FileHash -LiteralPath $db).Hash -ne $before){throw 'Uninstall modified isolated DB'}
    if(-not(Test-Path -LiteralPath (Join-Path $data 'preserve-user-data.txt'))){throw 'User data sentinel missing'}
    $remaining=@(Get-ItemProperty HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* -ErrorAction SilentlyContinue | Where-Object {$_.DisplayName -like 'Career Assistant*'})
    $deadline=(Get-Date).AddSeconds(60)
    while($remaining.Count -and (Get-Date)-lt $deadline){
        Start-Sleep -Milliseconds 300
        $remaining=@(Get-ItemProperty HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* -ErrorAction SilentlyContinue | Where-Object {$_.DisplayName -like 'Career Assistant*'})
    }
    if($remaining.Count){throw 'Test uninstall registration remains; no manual registry deletion attempted'}
    Write-Output 'Normal uninstall PASS; isolated database and sentinel preserved; test uninstall registration removed'
    Write-Output "Retained test data: $data"
} finally {foreach($n in $envNames){[Environment]::SetEnvironmentVariable($n,$saved[$n],'Process')}}
