<#
.SYNOPSIS
    업무보드를 로컬에서 미리 보기 위한 작은 웹서버.
.DESCRIPTION
    이 앱은 ES 모듈을 쓰기 때문에 파일을 더블클릭(file://)해서는 열리지 않는다.
    브라우저가 모듈을 http(s) 로만 불러오기 때문이다.
    Node 나 Python 없이 PowerShell 만으로 정적 파일을 서빙한다.

    Ctrl+C 로 종료한다.
.EXAMPLE
    powershell -File .\serve.ps1
    powershell -File .\serve.ps1 -Port 8080 -NoBrowser
#>
[CmdletBinding()]
param(
    [int]$Port = 5173,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot 'src'
if (-not (Test-Path $root)) { throw "src 폴더를 찾을 수 없습니다: $root" }

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.mjs'  = 'text/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.ico'  = 'image/x-icon'
    '.webmanifest' = 'application/manifest+json'
}

$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)

try {
    $listener.Start()
} catch {
    throw "포트 $Port 를 열지 못했습니다. 다른 포트로 시도하세요: .\serve.ps1 -Port 5174"
}

Write-Host ""
Write-Host "  업무보드 미리보기" -ForegroundColor Cyan
Write-Host "  $prefix" -ForegroundColor Green
Write-Host "  종료하려면 Ctrl+C" -ForegroundColor DarkGray
Write-Host ""

if (-not $NoBrowser) {
    $chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
    if (Test-Path $chrome) { Start-Process $chrome -ArgumentList $prefix }
    else { Start-Process $prefix }
}

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $req = $context.Request
        $res = $context.Response

        try {
            $rel = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')
            if (-not $rel) { $rel = 'index.html' }

            $full = Join-Path $root ($rel -replace '/', '\')

            # src 밖으로 나가는 경로 요청은 막는다
            $fullResolved = [System.IO.Path]::GetFullPath($full)
            $rootResolved = [System.IO.Path]::GetFullPath($root)
            if (-not $fullResolved.StartsWith($rootResolved)) {
                $res.StatusCode = 403
                $res.Close()
                continue
            }

            if (-not (Test-Path -LiteralPath $fullResolved -PathType Leaf)) {
                $res.StatusCode = 404
                $bytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $rel")
                $res.ContentType = 'text/plain; charset=utf-8'
                $res.ContentLength64 = $bytes.Length
                $res.OutputStream.Write($bytes, 0, $bytes.Length)
                $res.Close()
                Write-Host ("  404  {0}" -f $rel) -ForegroundColor DarkYellow
                continue
            }

            $ext = [System.IO.Path]::GetExtension($fullResolved).ToLowerInvariant()
            $type = $mime[$ext]
            if (-not $type) { $type = 'application/octet-stream' }

            $bytes = [System.IO.File]::ReadAllBytes($fullResolved)
            $res.ContentType = $type
            $res.Headers.Add('Cache-Control', 'no-store')   # 고치는 즉시 반영되도록
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
            $res.Close()
            Write-Host ("  200  {0}" -f $rel) -ForegroundColor DarkGray
        }
        catch {
            try { $res.StatusCode = 500; $res.Close() } catch { }
        }
    }
}
finally {
    $listener.Stop()
    $listener.Close()
    Write-Host "`n  서버를 닫았습니다." -ForegroundColor DarkGray
}
