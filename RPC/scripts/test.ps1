$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    & .\mvnw.cmd -B -ntp package
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o cliente Java.' }
    & .\.venv\Scripts\python.exe -m unittest discover -s test -p 'test_*.py' -v
    if ($LASTEXITCODE -ne 0) { throw 'Falha nos testes de integração.' }
} finally {
    Pop-Location
}
