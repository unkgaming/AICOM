# PowerShell script for keyboard/mouse automation
# Usage: powershell -File input-control.ps1 <action> <args>
param(
    [string]$action,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$inputArgs
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Resolve-AppTarget {
    param([string]$target)

    if ([string]::IsNullOrWhiteSpace($target)) {
        $normalized = ""
    } else {
        $normalized = $target.Trim().ToLower()
        $normalized = [regex]::Replace($normalized, '[\.,!\?]+$', '')
    }

    $map = @{
        "vscode" = "code"
        "vs code" = "code"
        "visual studio code" = "code"
        "steam" = "steam://open/main"
        "stream" = "steam://open/main"
        "tmodloader" = "steam://rungameid/1281930"
        "tmod loader" = "steam://rungameid/1281930"
        "terraria" = "steam://rungameid/105600"
        "discord" = "discord"
        "brave" = "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe"
        "chrome" = "chrome"
        "firefox" = "firefox"
        "edge" = "msedge"
        "microsoft edge" = "msedge"
        "ms edge" = "msedge"
        "notepad" = "notepad"
        "calculator" = "calc"
        "cmd" = "cmd"
        "powershell" = "powershell"
    }

    if ($map.ContainsKey($normalized)) {
        return $map[$normalized]
    }

    return $target
}

function Resolve-ProcessName {
    param([string]$target)

    if ([string]::IsNullOrWhiteSpace($target)) {
        return ""
    }

    $normalized = $target.Trim().ToLower()
    $normalized = [regex]::Replace($normalized, '[\.,!\?]+$', '')

    $map = @{
        "vscode" = "Code"
        "vs code" = "Code"
        "visual studio code" = "Code"
        "steam" = "steam"
        "stream" = "steam"
        "discord" = "Discord"
        "brave" = "brave"
        "chrome" = "chrome"
        "firefox" = "firefox"
        "edge" = "msedge"
        "microsoft edge" = "msedge"
        "ms edge" = "msedge"
        "notepad" = "notepad"
        "calculator" = "CalculatorApp"
        "cmd" = "cmd"
        "powershell" = "powershell"
    }

    if ($map.ContainsKey($normalized)) {
        return $map[$normalized]
    }

    return $target
}

function Find-StartMenuShortcut {
    param([string]$name)

    if ([string]::IsNullOrWhiteSpace($name)) {
        return $null
    }

    $normalizedName = $name.Trim().ToLower()
    $paths = @(
        "$env:ProgramData\Microsoft\Windows\Start Menu\Programs",
        "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"
    )

    foreach ($p in $paths) {
        if (-not (Test-Path $p)) {
            continue
        }

        $match = Get-ChildItem -Path $p -Filter "*.lnk" -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.BaseName.ToLower().Contains($normalizedName) } |
            Select-Object -First 1

        if ($match) {
            return $match.FullName
        }
    }

    return $null
}

function Get-BravePath {
    $braveCandidates = @(
        "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
        "$env:ProgramFiles(x86)\BraveSoftware\Brave-Browser\Application\brave.exe",
        "$env:LocalAppData\BraveSoftware\Brave-Browser\Application\brave.exe"
    )

    foreach ($candidate in $braveCandidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    return $null
}

function Ensure-Win32Input {
    if (([System.Management.Automation.PSTypeName]'Win32Functions.Win32Input').Type) {
        return
    }

    $typeDef = @"
using System;
using System.Runtime.InteropServices;

namespace Win32Functions {
    public static class Win32Input {
        [StructLayout(LayoutKind.Sequential)]
        public struct POINT {
            public int X;
            public int Y;
        }

        [DllImport("user32.dll", SetLastError=true)]
        public static extern bool SetCursorPos(int X, int Y);

        [DllImport("user32.dll", SetLastError=true)]
        public static extern bool GetCursorPos(out POINT lpPoint);

        [DllImport("user32.dll", CharSet = CharSet.Auto, CallingConvention = CallingConvention.StdCall)]
        public static extern void mouse_event(long dwFlags, long dx, long dy, long cButtons, long dwExtraInfo);
    }
}
"@

    Add-Type -TypeDefinition $typeDef -Language CSharp
}

function Get-CursorPosition {
    Ensure-Win32Input
    $p = New-Object Win32Functions.Win32Input+POINT
    [void][Win32Functions.Win32Input]::GetCursorPos([ref]$p)
    return @{ X = $p.X; Y = $p.Y }
}

function Set-CursorPosition {
    param([int]$x, [int]$y)
    Ensure-Win32Input
    return [Win32Functions.Win32Input]::SetCursorPos($x, $y)
}

function Set-CursorPositionVerified {
    param([int]$x, [int]$y)

    $setOk = Set-CursorPosition -x $x -y $y
    Start-Sleep -Milliseconds 45
    $actual = Get-CursorPosition

    $ok = $setOk -and ([Math]::Abs($actual.X - $x) -le 2) -and ([Math]::Abs($actual.Y - $y) -le 2)
    if ($ok) {
        return @{ Ok = $true; X = $actual.X; Y = $actual.Y; Method = "SetCursorPos" }
    }

    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)
    Start-Sleep -Milliseconds 45
    $actualFallback = Get-CursorPosition
    $okFallback = ([Math]::Abs($actualFallback.X - $x) -le 2) -and ([Math]::Abs($actualFallback.Y - $y) -le 2)

    return @{ Ok = $okFallback; X = $actualFallback.X; Y = $actualFallback.Y; Method = "Cursor.Position" }
}

function Invoke-LeftClick {
    Ensure-Win32Input
    $MOUSEEVENTF_LEFTDOWN = 0x02
    $MOUSEEVENTF_LEFTUP = 0x04
    [Win32Functions.Win32Input]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
    [Win32Functions.Win32Input]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
}

if ($action -eq "type") {
    [System.Windows.Forms.SendKeys]::SendWait($inputArgs[0])
    Write-Output "typed"
} elseif ($action -eq "moveMouse") {
    $x = [int]$inputArgs[0]
    $y = [int]$inputArgs[1]
    $result = Set-CursorPositionVerified -x $x -y $y
    if (-not $result.Ok) {
        Write-Output "move failed ($($result.X),$($result.Y))"
        exit 1
    }
    Write-Output "moved ($($result.X),$($result.Y)) via $($result.Method)"
} elseif ($action -eq "mouseClick") {
    Invoke-LeftClick
    Write-Output "clicked"
} elseif ($action -eq "clickAt") {
    if (-not $inputArgs[0] -or -not $inputArgs[1]) {
        Write-Output "Missing click coordinates"
        exit 1
    }

    $x = [int]$inputArgs[0]
    $y = [int]$inputArgs[1]
    $result = Set-CursorPositionVerified -x $x -y $y
    if (-not $result.Ok) {
        Write-Output "move failed ($($result.X),$($result.Y))"
        exit 1
    }
    Start-Sleep -Milliseconds 70
    Invoke-LeftClick
    $actual = Get-CursorPosition
    Write-Output "clicked at ($($actual.X),$($actual.Y)) via $($result.Method)"
} elseif ($action -eq "doubleClickAt") {
    if (-not $inputArgs[0] -or -not $inputArgs[1]) {
        Write-Output "Missing double-click coordinates"
        exit 1
    }

    $x = [int]$inputArgs[0]
    $y = [int]$inputArgs[1]
    $result = Set-CursorPositionVerified -x $x -y $y
    if (-not $result.Ok) {
        Write-Output "move failed ($($result.X),$($result.Y))"
        exit 1
    }
    Start-Sleep -Milliseconds 70
    Invoke-LeftClick
    Start-Sleep -Milliseconds 90
    Invoke-LeftClick
    $actual = Get-CursorPosition
    Write-Output "double clicked at ($($actual.X),$($actual.Y)) via $($result.Method)"
} elseif ($action -eq "launchApp") {
    if (-not $inputArgs[0]) {
        Write-Output "Missing app target"
        exit 1
    }

    $rawTarget = ($inputArgs -join " ").Trim()
    $rawTarget = [regex]::Replace($rawTarget, '[\.,!\?]+$', '')
    $target = Resolve-AppTarget -target $rawTarget

    try {
        if ($target -match '^(https?:|steam://)') {
            Start-Process $target
            Write-Output "launched"
            exit 0
        }

        Start-Process -FilePath $target
        Write-Output "launched"
    } catch {
        try {
            $shortcut = Find-StartMenuShortcut -name $rawTarget
            if ($shortcut) {
                Start-Process -FilePath $shortcut
                Write-Output "launched"
                exit 0
            }

            Start-Process cmd.exe -ArgumentList "/c", "start", "", "`"$target`""
            Write-Output "launched"
        } catch {
            Write-Output "Failed to launch: $target"
            exit 1
        }
    }
} elseif ($action -eq "openInBrave") {
    if (-not $inputArgs[0]) {
        Write-Output "Missing target for Brave"
        exit 1
    }

    $bravePath = Get-BravePath
    if (-not $bravePath) {
        Write-Output "Brave not found"
        exit 1
    }

    $rawTarget = ($inputArgs -join " ").Trim()
    $rawTarget = [regex]::Replace($rawTarget, '[\.,!\?]+$', '')

    $destination = $rawTarget
    if ($rawTarget -match '^(https?://)') {
        $destination = $rawTarget
    } elseif ($rawTarget -match '^[\w.-]+\.[a-zA-Z]{2,}(/.*)?$') {
        $destination = "https://$rawTarget"
    } else {
        $destination = "https://www.google.com/search?q=$([uri]::EscapeDataString($rawTarget))"
    }

    Start-Process -FilePath $bravePath -ArgumentList $destination
    Write-Output "opened in brave"
} elseif ($action -eq "closeApp") {
    if (-not $inputArgs[0]) {
        Write-Output "Missing app target"
        exit 1
    }

    $rawTarget = ($inputArgs -join " ").Trim()
    $processName = Resolve-ProcessName -target $rawTarget

    try {
        $procs = Get-Process -Name $processName -ErrorAction SilentlyContinue
        if (-not $procs) {
            $procs = Get-Process | Where-Object { $_.ProcessName.ToLower().Contains($processName.ToLower()) }
        }

        if (-not $procs) {
            Write-Output "No running process found for: $rawTarget"
            exit 1
        }

        $procs | Stop-Process -Force -ErrorAction Stop
        Write-Output "closed"
    } catch {
        Write-Output "Failed to close: $rawTarget"
        exit 1
    }
} elseif ($action -eq "emptyRecycleBin") {
    try {
        Clear-RecycleBin -Force -ErrorAction Stop
        Write-Output "recycle bin emptied"
    } catch {
        Write-Output "Failed to empty recycle bin"
        exit 1
    }
} elseif ($action -eq "scenarioDiscordMessage") {
    if (-not $inputArgs[0]) {
        Write-Output "Missing discord message"
        exit 1
    }

    $message = ($inputArgs -join " ")
    try {
        Start-Process -FilePath "discord" -ErrorAction Stop
    } catch {
        $shortcut = Find-StartMenuShortcut -name "discord"
        if ($shortcut) {
            Start-Process -FilePath $shortcut
        } else {
            Write-Output "Discord not found"
            exit 1
        }
    }

    Start-Sleep -Milliseconds 1800
    $wshell = New-Object -ComObject WScript.Shell
    $null = $wshell.AppActivate("Discord")
    Start-Sleep -Milliseconds 350

    [System.Windows.Forms.SendKeys]::SendWait($message)
    Start-Sleep -Milliseconds 120
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    Write-Output "discord message sent"
} elseif ($action -eq "scenarioBraveYouTubeFirstVideo") {
    $bravePath = Get-BravePath

    if (-not $bravePath) {
        Write-Output "Brave not found"
        exit 1
    }

    Start-Process -FilePath $bravePath
    Start-Sleep -Milliseconds 2200

    $wshell = New-Object -ComObject WScript.Shell
    $null = $wshell.AppActivate("Brave")
    Start-Sleep -Milliseconds 300

    [System.Windows.Forms.SendKeys]::SendWait("^l")
    Start-Sleep -Milliseconds 250
    [System.Windows.Forms.SendKeys]::SendWait("youtube.com")
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    Start-Sleep -Milliseconds 4200

    [System.Windows.Forms.SendKeys]::SendWait("{TAB}")
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    Write-Output "scenario complete"
} else {
    Write-Output "unknown action"
    exit 1
}
