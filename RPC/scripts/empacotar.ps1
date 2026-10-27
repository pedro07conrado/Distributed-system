param(
    [string] $OutputPath
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputPath) {
    $OutputPath = Join-Path (Split-Path -Parent $projectRoot) 'RPC_a2515725.zip'
}
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
# Lista explícita: executáveis do banco, dados e dependências ficam fora da entrega.
$includedPaths = @(
    'client', 'examples', 'proto', 'scripts', 'server', 'test', '.mvn',
    'pom.xml', 'mvnw', 'mvnw.cmd', 'requirements.txt', 'README.md', 'compose.yaml', '.gitignore', '.gitattributes'
)
$files = foreach ($relativePath in $includedPaths) {
    $item = Get-Item -LiteralPath (Join-Path $projectRoot $relativePath)
    if ($item.PSIsContainer) {
        Get-ChildItem -LiteralPath $item.FullName -Recurse -File |
            Where-Object { $_.FullName -notmatch '[\\/]__pycache__[\\/]|\.py[co]$|\.log$' }
    } else {
        $item
    }
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = [System.IO.File]::Open($OutputPath, [System.IO.FileMode]::Create)
try {
    $archive = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in $files) {
            $relativePath = $file.FullName.Substring($projectRoot.Length + 1).Replace('\', '/')
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive, $file.FullName, "RPC/$relativePath",
                [System.IO.Compression.CompressionLevel]::Optimal
            ) | Out-Null
        }
    } finally {
        $archive.Dispose()
    }
} finally {
    $stream.Dispose()
}
$size = (Get-Item -LiteralPath $OutputPath).Length
Write-Host ("Pacote criado: {0} ({1:N1} KB)" -f $OutputPath, ($size / 1KB))
