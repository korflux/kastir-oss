# Starts / checks the canonical LOCAL test stack for Kastir (.env loopback).
# Prefer: docker compose up -d
# Fallback on Windows when Docker engine is unavailable:
#   - Postgres 16 native service (user/db kastir, password kastir, port 5432)
#   - Redis 5+ from .tools/redis on port 6380 (Redis 3 Windows service is too old for BullMQ)
#
# Usage (from repo root):
#   pwsh scripts/start-local-test-stack.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Test-Port([int]$Port) {
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

Write-Host "== Kastir local test stack =="

# --- Postgres ---
if (Test-Port 5432) {
  Write-Host "Postgres: already listening on :5432"
} else {
  $svc = Get-Service postgresql-x64-16 -ErrorAction SilentlyContinue
  if ($svc) {
    if ($svc.Status -ne "Running") { Start-Service postgresql-x64-16 }
    Write-Host "Postgres: started service postgresql-x64-16"
  } else {
    Write-Host "Postgres: not found. Run: docker compose up -d   OR install PostgreSQL 16"
    exit 1
  }
}

# --- Redis (BullMQ needs >= 5; Microsoft Archive 3.0.x is insufficient) ---
$redisDir = Join-Path $root ".tools\redis"
$redisServer = Join-Path $redisDir "redis-server.exe"
$redisCli = Join-Path $redisDir "redis-cli.exe"
$redisPort = 6380

if (-not (Test-Path $redisServer)) {
  Write-Host "Redis 5 binary missing under .tools/redis — downloading tporadowski 5.0.14.1..."
  New-Item -ItemType Directory -Force -Path $redisDir | Out-Null
  $zip = Join-Path $redisDir "Redis-x64-5.0.14.1.zip"
  $url = "https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip"
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  Expand-Archive -Path $zip -DestinationPath $redisDir -Force
}

if (Test-Port $redisPort) {
  Write-Host "Redis: already listening on :$redisPort"
} else {
  # Leave legacy Redis 3 on 6379 alone if we lack admin rights to stop it.
  $log = Join-Path $redisDir "server-$redisPort.log"
  Start-Process -FilePath $redisServer `
    -ArgumentList "--port",$redisPort,"--requirepass","kastir","--bind","127.0.0.1","--logfile",$log `
    -WorkingDirectory $redisDir -WindowStyle Hidden
  Start-Sleep -Seconds 1
  Write-Host "Redis: started 5.x on :$redisPort (password kastir)"
}

$pong = & $redisCli -h 127.0.0.1 -p $redisPort -a kastir ping 2>$null
if ("$pong" -notmatch "PONG") {
  Write-Host "Redis: failed to PONG on :$redisPort"
  exit 1
}

Write-Host ""
Write-Host "Canonical .env URLs for this machine:"
Write-Host "  DATABASE_URL=postgresql://kastir:kastir@localhost:5432/kastir"
Write-Host "  REDIS_URL=redis://:kastir@localhost:$redisPort"
Write-Host "Then: pnpm exec prisma migrate deploy"
Write-Host "OK"
