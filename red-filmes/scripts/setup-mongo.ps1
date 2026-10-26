$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimePath = Join-Path $projectRoot '.runtime'
$downloadPath = Join-Path $runtimePath 'downloads'
New-Item -ItemType Directory -Path $downloadPath -Force | Out-Null

function Get-Download([string] $url, [string] $destination) {
    if (-not (Test-Path -LiteralPath $destination)) {
        $partialPath = $destination + '.part'
        Write-Host "Baixando $url"
        & curl.exe --fail --location --retry 3 --continue-at - --output $partialPath $url
        if ($LASTEXITCODE -ne 0) { throw 'Falha no download. Execute o script novamente para continuar.' }
        Move-Item -LiteralPath $partialPath -Destination $destination
    }
}

$serverZip = Join-Path $downloadPath 'mongodb.zip'
$toolsZip = Join-Path $downloadPath 'mongodb-tools.zip'
$archivePath = Join-Path $downloadPath 'sampledata.archive'
$serverPath = Join-Path $runtimePath 'mongodb'
$toolsPath = Join-Path $runtimePath 'tools'

if (-not (Get-ChildItem -LiteralPath $serverPath -Filter mongod.exe -Recurse -ErrorAction SilentlyContinue)) {
    Get-Download 'https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-8.0.34.zip' $serverZip
    Expand-Archive -LiteralPath $serverZip -DestinationPath $serverPath -Force
}
if (-not (Get-ChildItem -LiteralPath $toolsPath -Filter mongorestore.exe -Recurse -ErrorAction SilentlyContinue)) {
    Get-Download 'https://fastdl.mongodb.org/tools/db/mongodb-database-tools-windows-x86_64-100.19.0.zip' $toolsZip
    Expand-Archive -LiteralPath $toolsZip -DestinationPath $toolsPath -Force
}

& (Join-Path $PSScriptRoot 'start-mongo.ps1')
$pythonPath = Join-Path $projectRoot '.venv\Scripts\python.exe'
& $pythonPath -c "from pymongo import MongoClient; c=MongoClient('mongodb://127.0.0.1:27017',serverSelectionTimeoutMS=5000); print('Filmes existentes:',c.sample_mflix.movies.count_documents({})); raise SystemExit(0 if c.sample_mflix.movies.estimated_document_count() else 2)"
if ($LASTEXITCODE -eq 0) {
    Write-Host 'A coleção movies já possui dados. A importação foi preservada.'
    return
}
if ($LASTEXITCODE -ne 2) { throw 'Falha ao consultar o MongoDB local.' }

Get-Download 'https://atlas-education.s3.amazonaws.com/sampledata.archive' $archivePath
$restorePath = (Get-ChildItem -LiteralPath $toolsPath -Filter mongorestore.exe -Recurse | Select-Object -First 1).FullName
# Importa somente os filmes. Não usa --drop e não importa usuários ou outras bases.
& $restorePath '--uri=mongodb://127.0.0.1:27017' "--archive=$archivePath" '--nsInclude=sample_mflix.movies' --stopOnError
if ($LASTEXITCODE -ne 0) { throw 'Falha na importação. Verifique a saída do mongorestore.' }
& $pythonPath -c "from pymongo import MongoClient; c=MongoClient('mongodb://127.0.0.1:27017'); print('Filmes importados:',c.sample_mflix.movies.count_documents({}))"
