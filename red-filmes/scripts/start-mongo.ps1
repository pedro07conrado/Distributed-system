$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimePath = Join-Path $projectRoot '.runtime'
$pythonPath = Join-Path $projectRoot '.venv\Scripts\python.exe'

# Reutiliza um MongoDB já disponível, sem alterar sua configuração.
& $pythonPath -c "from pymongo import MongoClient; c=MongoClient('mongodb://127.0.0.1:27017',serverSelectionTimeoutMS=1000); c.admin.command('ping')" 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host 'MongoDB já está disponível em 127.0.0.1:27017.'
    return
}

$serverPath = Join-Path $runtimePath 'mongodb'
$mongodPath = (Get-ChildItem -LiteralPath $serverPath -Filter mongod.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
if (-not $mongodPath) { throw 'MongoDB não encontrado. Execute scripts/setup-mongo.ps1 primeiro.' }
$dataPath = Join-Path $runtimePath 'data'
$logPath = Join-Path $runtimePath 'mongod.log'
New-Item -ItemType Directory -Path $dataPath -Force | Out-Null
$mongoArguments = @('--dbpath', ('"' + $dataPath + '"'), '--bind_ip', '127.0.0.1', '--port', '27017', '--logpath', ('"' + $logPath + '"'), '--logappend')
$process = Start-Process -FilePath $mongodPath -ArgumentList $mongoArguments -WindowStyle Hidden -PassThru
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 500
    & $pythonPath -c "from pymongo import MongoClient; c=MongoClient('mongodb://127.0.0.1:27017',serverSelectionTimeoutMS=500); c.admin.command('ping')" 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "MongoDB iniciado em 127.0.0.1:27017 (PID $($process.Id))."
        return
    }
    $process.Refresh()
    if ($process.HasExited) { break }
}
throw "MongoDB não iniciou. Consulte $logPath"
