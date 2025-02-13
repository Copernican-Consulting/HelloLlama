!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "WinMessages.nsh"

Name "Hello Llama"
OutFile "dist\HelloLlama-Setup.exe"
InstallDir "$PROGRAMFILES64\Hello Llama"
RequestExecutionLevel admin

!define MUI_ABORTWARNING

# Progress page settings
!define MUI_PAGE_HEADER_TEXT "Installing Hello Llama"
!define MUI_PAGE_HEADER_SUBTEXT "Please wait while Hello Llama is being installed..."
!define MUI_INSTFILESPAGE_COLORS "FFFFFF 000000" # Normal text color
!define MUI_INSTFILESPAGE_PROGRESSBAR "colored"

# Installation steps
!define STEP_NODEJS_INSTALL 50
!define STEP_APP_INSTALL 75
!define STEP_COMPLETE 100

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "English"

# Logging function
!define LogMessage "!insertmacro LogMessage"
!macro LogMessage text
    FileOpen $9 "$TEMP\HelloLlama_Install.log" a
    FileSeek $9 0 END
    # Get timestamp using PowerShell
    nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "Get-Date -Format ''[yyyy-MM-dd HH:mm:ss]''"'
    Pop $R0
    Pop $R1
    FileWrite $9 "$R1${text}$\r$\n"
    FileClose $9
    DetailPrint "${text}"
!macroend

# Function to backup settings
Function BackupSettings
    ${LogMessage} "Backing up application settings..."
    
    # Create backup directory
    CreateDirectory "$TEMP\HelloLlama_Backup"
    
    # Check if old settings exist
    IfFileExists "$APPDATA\HelloLlama\Local Storage\leveldb\*.ldb" 0 NoOldSettings
        
    # Backup Local Storage
    CopyFiles /SILENT "$APPDATA\HelloLlama\Local Storage\leveldb\*.*" "$TEMP\HelloLlama_Backup"
    ${LogMessage} "Settings backed up successfully"
    Goto BackupDone
    
    NoOldSettings:
    ${LogMessage} "No existing settings found"
    
    BackupDone:
FunctionEnd

# Function to restore settings
Function RestoreSettings
    ${LogMessage} "Restoring application settings..."
    
    # Check if we have backed up settings
    IfFileExists "$TEMP\HelloLlama_Backup\*.ldb" 0 NoBackup
        
    # Create directories if they don't exist
    CreateDirectory "$APPDATA\HelloLlama"
    CreateDirectory "$APPDATA\HelloLlama\Local Storage"
    CreateDirectory "$APPDATA\HelloLlama\Local Storage\leveldb"
        
    # Restore settings
    CopyFiles /SILENT "$TEMP\HelloLlama_Backup\*.*" "$APPDATA\HelloLlama\Local Storage\leveldb"
    ${LogMessage} "Settings restored successfully"
    Goto RestoreDone
    
    NoBackup:
    ${LogMessage} "No settings backup found"
    
    RestoreDone:
    # Clean up backup
    RMDir /r "$TEMP\HelloLlama_Backup"
FunctionEnd

Section "MainSection" SEC01
    SetOutPath "$INSTDIR"
    SetAutoClose false
    
    # Backup existing settings
    Call BackupSettings
    
    # Initialize log file
    FileOpen $9 "$TEMP\HelloLlama_Install.log" w
    FileWrite $9 "Hello Llama Installation Log$\r$\n"
    FileWrite $9 "==========================$\r$\n"
    FileClose $9
    ${LogMessage} "Installation started"
    
    # Step 1: Install Node.js first
    DetailPrint "Downloading and installing Node.js..."
    SetOutPath "$TEMP"
    nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "try { Invoke-WebRequest -Uri https://nodejs.org/dist/v18.19.0/node-v18.19.0-x64.msi -OutFile $TEMP\node.msi; exit 0 } catch { exit 1 }"'
    Pop $0 # Return value
    Pop $1 # Output
    
    ${If} ${Errors} 
        MessageBox MB_OK|MB_ICONSTOP "Failed to download Node.js installer. Please check your internet connection."
        Abort
    ${EndIf}
    
    ${If} $0 != 0
        MessageBox MB_OK|MB_ICONSTOP "Failed to download Node.js installer (Error code: $0)"
        Abort
    ${EndIf}
    ClearErrors
    ExecWait 'msiexec /i "$TEMP\node.msi" /qn ADDLOCAL=ALL' $0
    
    ${If} ${Errors} 
        MessageBox MB_OK|MB_ICONSTOP "Error during Node.js installation"
        Delete "$TEMP\node.msi"
        Abort
    ${EndIf}
    
    ${If} $0 != 0
        MessageBox MB_OK|MB_ICONSTOP "Node.js installation failed (Error code: $0)"
        Delete "$TEMP\node.msi"
        Abort
    ${EndIf}
    
    Delete "$TEMP\node.msi"
    
    # Configure Node.js environment
    DetailPrint "Configuring Node.js environment..."
    ReadRegStr $0 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"
    WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "$0;$PROGRAMFILES64\nodejs;$APPDATA\npm"
    SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
    Sleep 3000
    
    # Step 4: Copy application files
    DetailPrint "Installing Hello Llama application..."
    
    # Create resources directory structure
    SetOutPath "$INSTDIR\resources\app"
    File "package.json"
    File "main.js"
    
    # Create src directory and copy files
    SetOutPath "$INSTDIR\resources\app\src"
    File "src\index.html"
    File "src\renderer.js"
    File "src\styles.css"
    
    # Copy Prompts directory with all subdirectories
    ${LogMessage} "Copying Prompts directory..."
    SetOutPath "$INSTDIR\resources\app\Prompts"
    File /r "Prompts\*.*"
    
    # Create root directory shortcuts and scripts
    SetOutPath "$INSTDIR"
    
    # Verify required files exist
    IfFileExists "$INSTDIR\resources\app\package.json" 0 InstallError
    IfFileExists "$INSTDIR\resources\app\Prompts\systemPrompt.txt" 0 InstallError
    Goto FilesExist
    
    InstallError:
        MessageBox MB_OK|MB_ICONSTOP "Error: package.json not found. Installation may be incomplete."
        Abort
    
    FilesExist:
    
    # Create start script
    DetailPrint "Creating startup scripts..."
    FileOpen $0 "$INSTDIR\start.bat" w
    FileWrite $0 "@echo off$\r$\n"
    FileWrite $0 "cd /d $INSTDIR\resources\app$\r$\n"
    FileWrite $0 "set PATH=%PATH%;%PROGRAMFILES%\nodejs;%APPDATA%\npm$\r$\n"
    FileWrite $0 "if not exist node_modules ($\r$\n"
    FileWrite $0 "  echo Installing dependencies...$\r$\n"
    FileWrite $0 "  call npm install$\r$\n"
    FileWrite $0 ")$\r$\n"
    FileWrite $0 "npm start$\r$\n"
    FileWrite $0 "pause$\r$\n"
    FileClose $0
    
    CreateDirectory "$SMPROGRAMS\Hello Llama"
    CreateShortCut "$SMPROGRAMS\Hello Llama\Hello Llama.lnk" "$INSTDIR\start.bat"
    CreateShortCut "$DESKTOP\Hello Llama.lnk" "$INSTDIR\start.bat"
    
    # Install npm dependencies
    DetailPrint "Installing npm dependencies..."
    SetOutPath "$INSTDIR\resources\app"
    ClearErrors
    ExecWait 'cmd.exe /c "set PATH=%PATH%;%PROGRAMFILES%\nodejs;%APPDATA%\npm && npm install"' $0
    
    ${If} ${Errors} 
        MessageBox MB_OK|MB_ICONSTOP "Error during npm dependencies installation"
        Abort
    ${EndIf}
    
    ${If} $0 != 0
        MessageBox MB_OK|MB_ICONSTOP "Failed to install npm dependencies (Error code: $0)"
        Abort
    ${EndIf}
    
    # Complete Installation
    DetailPrint "Completing installation..."
    WriteUninstaller "$INSTDIR\uninstall.exe"
    
    # Restore settings
    Call RestoreSettings
    
    DetailPrint "Installation completed successfully!"
SectionEnd

Section "Uninstall"
    Delete "$INSTDIR\uninstall.exe"
    RMDir /r "$INSTDIR"
    
    Delete "$SMPROGRAMS\Hello Llama\Hello Llama.lnk"
    Delete "$DESKTOP\Hello Llama.lnk"
    RMDir "$SMPROGRAMS\Hello Llama"
    
    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Hello Llama"
SectionEnd
