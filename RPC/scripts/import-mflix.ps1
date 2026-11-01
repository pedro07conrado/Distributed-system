param(
    [string] $RestorePath = 'mongorestore',
    [string] $ArchivePath = (Join-Path $env:LOCALAPPDATA 'Distributed-system\mflix\sampledata.archive')
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Execute scripts/setup.ps1 primeiro.' }
if (-not (Get-Command $RestorePath -ErrorAction SilentlyContinue)) {
    throw 'Instale MongoDB Database Tools e informe -RestorePath com o caminho de mongorestore.exe.'
}
# Não sobrescreve uma coleção com dados e não instala MongoDB no projeto.
& $pythonPath -c "import os; from pymongo import MongoClient; c=MongoClient(os.getenv('MONGODB_URI','mongodb://127.0.0.1:27017'),serverSelectionTimeoutMS=5000); n=c[os.getenv('MONGODB_DATABASE','sample_mflix')].movies.count_documents({}); print('Filmes existentes:',n); raise SystemExit(0 if n else 2)"
if ($LASTEXITCODE -eq 0) {
    Write-Host 'A coleção já possui dados. Importação ignorada.'
    return
}
if ($LASTEXITCODE -ne 2) { throw 'Não foi possível consultar o MongoDB.' }

$ArchivePath = [System.IO.Path]::GetFullPath($ArchivePath)
if (-not (Test-Path -LiteralPath $ArchivePath)) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $ArchivePath) -Force | Out-Null
    $partialPath = $ArchivePath + '.part'
    & curl.exe --fail --location --retry 3 --continue-at - --output $partialPath 'https://atlas-education.s3.amazonaws.com/sampledata.archive'
    if ($LASTEXITCODE -ne 0) { throw 'Falha no download. Execute novamente para continuar.' }
    Move-Item -LiteralPath $partialPath -Destination $ArchivePath
}
$uri = if ($env:MONGODB_URI) { $env:MONGODB_URI } else { 'mongodb://127.0.0.1:27017' }
$database = if ($env:MONGODB_DATABASE) { $env:MONGODB_DATABASE } else { 'sample_mflix' }
if ($database -notmatch '^[A-Za-z0-9_-]+$') { throw 'Nome de banco inválido para importação.' }
$restoreArguments = @("--uri=$uri", "--archive=$ArchivePath", '--nsInclude=sample_mflix.movies', '--stopOnError')
if ($database -ne 'sample_mflix') {
    $restoreArguments += @('--nsFrom=sample_mflix.movies', "--nsTo=$database.movies")
}
& $RestorePath @restoreArguments
if ($LASTEXITCODE -ne 0) { throw 'Falha na importação. Confira a saída de mongorestore.' }
Write-Host 'Importação de movies concluída.'
