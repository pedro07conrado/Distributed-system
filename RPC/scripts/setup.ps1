$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
        python -m venv .venv
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar o ambiente Python.' }
    }
    & .\.venv\Scripts\python.exe -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar dependências Python.' }
    npm.cmd ci --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar dependências Node.js.' }
    & .\.venv\Scripts\python.exe -m grpc_tools.protoc -I proto --python_out=server --grpc_python_out=server proto/movies.proto
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar os stubs gRPC.' }
    Write-Host 'Dependências instaladas e stubs gRPC gerados. Prepare o MongoDB conforme o README.'
} finally {
    Pop-Location
}
