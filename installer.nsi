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
!define STEP_OLLAMA_DOWNLOAD 16
!define STEP_OLLAMA_INSTALL 33
!define STEP_MODEL_DOWNLOAD 50
!define STEP_NODEJS_INSTALL 66
!define STEP_APP_INSTALL 83
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

Section "MainSection" SEC01
    SetOutPath "$INSTDIR"
    SetAutoClose false
    
    # Step 1: Install Node.js first
    DetailPrint "Downloading and installing Node.js..."
    SetOutPath "$TEMP"
    ExecWait 'powershell -Command "& {Invoke-WebRequest -Uri https://nodejs.org/dist/v18.19.0/node-v18.19.0-x64.msi -OutFile $\"$TEMP\node.msi$\"}"'
    ExecWait 'msiexec /i "$TEMP\node.msi" /qn ADDLOCAL=ALL'
    Delete "$TEMP\node.msi"
    
    # Configure Node.js environment
    DetailPrint "Configuring Node.js environment..."
    ReadRegStr $0 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"
    WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "$0;$PROGRAMFILES64\nodejs;$APPDATA\npm"
    SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
    Sleep 3000
    
    # Step 2: Install Ollama
    DetailPrint "Downloading Ollama..."
    ExecWait 'powershell -Command "Invoke-WebRequest -Uri https://ollama.ai/download/windows -OutFile $TEMP\ollama-installer.exe"'
    DetailPrint "Installing Ollama..."
    ExecWait '"$TEMP\ollama-installer.exe" /S'
    Delete "$TEMP\ollama-installer.exe"
    
    # Wait for Ollama installation and start service
    DetailPrint "Starting Ollama service..."
    Sleep 5000
    ExecWait 'powershell -Command "Start-Service ollama"'
    Sleep 2000
    
    # Step 3: Download llama3 model
    DetailPrint "Downloading llama3 model (this may take several minutes)..."
    ExecWait 'powershell -Command "ollama pull llama3:latest"'
    
    # Step 4: Copy application files
    DetailPrint "Installing Hello Llama application..."
    SetOutPath "$INSTDIR"
    File /r "src\*.*"
    File "main.js"
    File "package.json"
    
    # Verify package.json exists
    IfFileExists "$INSTDIR\package.json" 0 InstallError
    Goto FilesExist
    
    InstallError:
        MessageBox MB_OK|MB_ICONSTOP "Error: package.json not found. Installation may be incomplete."
        Abort
    
    FilesExist:
    
    # Create start script
    DetailPrint "Creating startup scripts..."
    FileOpen $0 "$INSTDIR\start.bat" w
    FileWrite $0 "@echo off$\r$\n"
    FileWrite $0 "cd /d $INSTDIR$\r$\n"
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
    SetOutPath "$INSTDIR"
    ExecWait 'cmd.exe /c "set PATH=%PATH%;%PROGRAMFILES%\nodejs;%APPDATA%\npm && npm install"'
    
    # Complete Installation
    DetailPrint "Completing installation..."
    WriteUninstaller "$INSTDIR\uninstall.exe"
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
