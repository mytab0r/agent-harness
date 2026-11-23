# Install the Agent Harness roles and skills into a Claude Code configuration.
#
#   .\install.ps1 [-DryRun] [-Target DIR]
#
# The target defaults to $env:CLAUDE_CONFIG_DIR or "$HOME\.claude". Existing
# files in agents\ and skills\ are overwritten. The script never touches
# settings.json and never writes outside the target directory.

[CmdletBinding()]
param(
    [switch]$DryRun,
    [string]$Target
)

$ErrorActionPreference = "Stop"

if (-not $Target -or $Target.Trim() -eq "") {
    if ($env:CLAUDE_CONFIG_DIR -and $env:CLAUDE_CONFIG_DIR.Trim() -ne "") {
        $Target = $env:CLAUDE_CONFIG_DIR
    } else {
        $Target = Join-Path $HOME ".claude"
    }
}

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Say([string]$Message) { Write-Host $Message }
function Fail([string]$Message) { Write-Error "error: $Message"; exit 1 }

foreach ($tool in @("node", "git", "gh")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        Fail "$tool is required"
    }
}

$nodeVersion = (& node --version).Trim()
$nodeMajor = [int](($nodeVersion.TrimStart("v") -split "\.")[0])
if ($nodeMajor -lt 20) {
    Fail "Node 20 or newer is required, found $nodeVersion"
}

try {
    & gh auth status *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Say "warning: gh is installed but not authenticated; run: gh auth login"
    }
} catch {
    Write-Say "warning: could not run gh auth status; run: gh auth login"
}

Write-Say "target: $Target"
Write-Say "source: $Here"

function Copy-Tree([string]$Kind) {
    $source = Join-Path $Here $Kind
    $destination = Join-Path $Target $Kind
    if (-not (Test-Path -LiteralPath $source -PathType Container)) {
        Fail "missing source directory: $source"
    }
    Get-ChildItem -LiteralPath $source -Recurse -File | ForEach-Object {
        $relative = $_.FullName.Substring($source.Length).TrimStart("\", "/")
        $out = Join-Path $destination $relative
        if ($DryRun) {
            Write-Say "would copy $Kind\$relative -> $out"
        } else {
            $parent = Split-Path -Parent $out
            if (-not (Test-Path -LiteralPath $parent)) {
                New-Item -ItemType Directory -Path $parent -Force | Out-Null
            }
            Copy-Item -LiteralPath $_.FullName -Destination $out -Force
            Write-Say "copied $Kind\$relative -> $out"
        }
    }
}

Copy-Tree "agents"
Copy-Tree "skills"

Write-Say ""
if (Get-Command claude -ErrorAction SilentlyContinue) {
    Write-Say "Claude Code found. Install the Superpowers plugin once:"
    Write-Say "  claude plugin install superpowers@claude-plugins-official"
} else {
    Write-Say "Claude Code ('claude') was not found on PATH."
    Write-Say "If you use Claude Code, install it and then run:"
    Write-Say "  claude plugin install superpowers@claude-plugins-official"
}

Write-Say ""
Write-Say "Installed agents:"
Write-Say "  analyst, developer, tester, critic, pm, librarian, orchestrator, steward"
Write-Say "Next: read docs/process.md and copy templates/ into your repository."
