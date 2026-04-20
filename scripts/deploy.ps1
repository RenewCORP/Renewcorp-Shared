# deploy.ps1 - push shared SQL migrations and Edge Functions to every configured Supabase project.
#
# Usage:
#   1. Copy scripts/projects.ps1.example to scripts/projects.ps1 and fill in your values.
#   2. From the renewcorp-shared repo root, run:
#        ./scripts/deploy.ps1                      # deploys to all projects
#        ./scripts/deploy.ps1 -Only Compass        # deploys to one project by Name
#        ./scripts/deploy.ps1 -SkipFunctions       # SQL only
#        ./scripts/deploy.ps1 -SkipDb              # Edge Functions only
#        ./scripts/deploy.ps1 -SetSecrets          # also push APP_NAME / FEEDBACK_TO_EMAIL / RESEND_API_KEY

[CmdletBinding()]
param(
  [string]$Only,
  [switch]$SkipDb,
  [switch]$SkipFunctions,
  [switch]$SetSecrets
)

$ErrorActionPreference = 'Stop'

$repoRoot   = Split-Path $PSScriptRoot -Parent
$configPath = Join-Path $PSScriptRoot "projects.ps1"

if (-not (Test-Path $configPath)) {
  Write-Error "scripts/projects.ps1 not found. Copy scripts/projects.ps1.example and fill in your values."
  exit 1
}

. $configPath

if (-not $AccessToken) { Write-Error "AccessToken not set in projects.ps1"; exit 1 }
if (-not $Projects -or $Projects.Count -eq 0) { Write-Error "No projects defined in projects.ps1"; exit 1 }

$env:SUPABASE_ACCESS_TOKEN = $AccessToken

$targets = if ($Only) { $Projects | Where-Object { $_.Name -eq $Only } } else { $Projects }
if (-not $targets) { Write-Error "No project matched -Only '$Only'"; exit 1 }

Push-Location $repoRoot
try {
  foreach ($p in $targets) {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "  $($p.Name)  ($($p.Ref))" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan

    if (-not $SkipDb) {
      if (-not $p.DbPassword) { Write-Error "DbPassword missing for $($p.Name)"; exit 1 }
      Write-Host "[*] Linking project..." -ForegroundColor Yellow
      $env:SUPABASE_DB_PASSWORD = $p.DbPassword
      supabase link --project-ref $p.Ref
      if ($LASTEXITCODE -ne 0) { Write-Error "link failed for $($p.Name)"; exit 1 }
      Write-Host "[*] Pushing SQL migrations..." -ForegroundColor Yellow
      supabase db push
      if ($LASTEXITCODE -ne 0) { Write-Error "db push failed for $($p.Name)"; exit 1 }
    }

    if (-not $SkipFunctions) {
      Write-Host "[*] Deploying send-feedback-email Edge Function..." -ForegroundColor Yellow
      supabase functions deploy send-feedback-email --project-ref $p.Ref
      if ($LASTEXITCODE -ne 0) { Write-Error "functions deploy failed for $($p.Name)"; exit 1 }
    }

    if ($SetSecrets) {
      if (-not $ResendApiKey)    { Write-Error "ResendApiKey not set in projects.ps1"; exit 1 }
      if (-not $p.AppName)       { Write-Error "AppName missing for $($p.Name)"; exit 1 }
      if (-not $p.FeedbackEmail) { Write-Error "FeedbackEmail missing for $($p.Name)"; exit 1 }
      Write-Host "[*] Setting Edge Function secrets..." -ForegroundColor Yellow
      supabase secrets set --project-ref $p.Ref `
        "APP_NAME=$($p.AppName)" `
        "FEEDBACK_TO_EMAIL=$($p.FeedbackEmail)" `
        "RESEND_API_KEY=$ResendApiKey"
      if ($LASTEXITCODE -ne 0) { Write-Error "secrets set failed for $($p.Name)"; exit 1 }
    }

    Write-Host "[OK] $($p.Name) done." -ForegroundColor Green
  }

  Write-Host ""
  Write-Host "All deployments complete." -ForegroundColor Green
}
finally {
  Pop-Location
}
