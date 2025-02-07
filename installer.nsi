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
    
    # Step 2: Install Ollama
    DetailPrint "Downloading Ollama..."
    
    # Download with error checking
    ClearErrors
    nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "try { Invoke-WebRequest -Uri https://ollama.ai/download/windows -OutFile $TEMP\ollama-installer.exe; exit 0 } catch { exit 1 }"'
    Pop $0 # Return value
    Pop $1 # Output
    
    ${If} ${Errors} 
        MessageBox MB_OK|MB_ICONSTOP "Failed to download Ollama installer. Please check your internet connection."
        Abort
    ${EndIf}
    
    ${If} $0 != 0
        MessageBox MB_OK|MB_ICONSTOP "Failed to download Ollama installer (Error code: $0)"
        Abort
    ${EndIf}
    
    # Verify installer exists and has content
    IfFileExists "$TEMP\ollama-installer.exe" +3
        MessageBox MB_OK|MB_ICONSTOP "Ollama installer not found after download"
        Abort
    
    # Check if Ollama is already installed
    DetailPrint "Checking for existing Ollama installation..."
    ClearErrors
    nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "try { Get-Service ollama -ErrorAction Stop | Out-Null; exit 0 } catch { exit 1 }"'
    Pop $0 # Return value
    Pop $1 # Output
    
    ${If} $0 == 0
        DetailPrint "Ollama is already installed"
    ${Else}
        # Install Ollama
        DetailPrint "Installing Ollama..."
        ClearErrors
        
        # Run installer with explicit admin privileges and wait
        DetailPrint "Running Ollama installer with admin privileges..."
        ExecWait '"$TEMP\ollama-installer.exe" /S' $0
        Pop $0 # Return value
        Pop $1 # Output
        
        ${If} ${Errors} 
            MessageBox MB_OK|MB_ICONSTOP "Error during Ollama installation: $1"
            Delete "$TEMP\ollama-installer.exe"
            Abort
        ${EndIf}
        
        ${If} $0 != 0
            MessageBox MB_OK|MB_ICONSTOP "Ollama installation failed (Error code: $0). Details: $1"
            Delete "$TEMP\ollama-installer.exe"
            Abort
        ${EndIf}
        
        Delete "$TEMP\ollama-installer.exe"
        
        # Give more time for installation to complete
        DetailPrint "Waiting for Ollama installation to complete..."
        Sleep 15000
    ${EndIf}
    
    # Verify installation
    DetailPrint "Verifying Ollama installation..."
    
    # Check if Ollama service exists and get its status
    ClearErrors
    nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "Get-Service ollama -ErrorAction Stop | Out-Null; exit 0"'
    Pop $0 # Return value
    Pop $1 # Output
    
    ${If} ${Errors} 
        MessageBox MB_OK|MB_ICONSTOP "Ollama service not found after installation"
        Abort
    ${EndIf}
    
    # Try to start the service if it's not running
    DetailPrint "Starting Ollama service..."
    ClearErrors
    nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "Start-Service ollama -ErrorAction Stop; exit 0"'
    Pop $0 # Return value
    Pop $1 # Output
    
    ${If} ${Errors} 
        MessageBox MB_OK|MB_ICONSTOP "Failed to start Ollama service"
        Abort
    ${EndIf}
    
    ${If} $0 != 0
        MessageBox MB_OK|MB_ICONSTOP "Failed to start Ollama service (Error code: $0)"
        Abort
    ${EndIf}
    
    # Wait for service to be fully running and verify it's responding
    DetailPrint "Waiting for Ollama service to start..."
    Sleep 5000
    
    # Verify service is responding
    ClearErrors
    nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "try { Invoke-WebRequest -Uri http://localhost:11434/api/tags -TimeoutSec 30; exit 0 } catch { exit 1 }"'
    Pop $0 # Return value
    Pop $1 # Output
    
    ${If} ${Errors} 
        MessageBox MB_OK|MB_ICONSTOP "Ollama service is not responding"
        Abort
    ${EndIf}
    
    ${If} $0 != 0
        MessageBox MB_OK|MB_ICONSTOP "Ollama service failed to respond (Error code: $0)"
        Abort
    ${EndIf}
    
    # Step 3: Download llama3 model
    DetailPrint "Downloading llama3 model (this may take several minutes)..."
    ClearErrors
    nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "try { ollama pull llama3:latest; exit 0 } catch { exit 1 }"'
    Pop $0 # Return value
    Pop $1 # Output
    
    ${If} ${Errors} 
        MessageBox MB_OK|MB_ICONSTOP "Error downloading llama3 model"
        Abort
    ${EndIf}
    
    ${If} $0 != 0
        MessageBox MB_OK|MB_ICONSTOP "Failed to download llama3 model (Error code: $0)"
        Abort
    ${EndIf}
    
    # Verify model was downloaded
    DetailPrint "Verifying llama3 model installation..."
    ClearErrors
    nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "try { Invoke-RestMethod http://localhost:11434/api/tags | ConvertTo-Json | Select-String ''llama3:latest'' | Out-Null; exit 0 } catch { exit 1 }"'
    Pop $0 # Return value
    Pop $1 # Output
    
    ${If} ${Errors} 
        MessageBox MB_OK|MB_ICONSTOP "Could not verify llama3 model installation"
        Abort
    ${EndIf}
    
    ${If} $0 != 0
        MessageBox MB_OK|MB_ICONSTOP "llama3 model was not found after download"
        Abort
    ${EndIf}
    
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
    
    # Create root directory shortcuts and scripts
    SetOutPath "$INSTDIR"
    
    # Verify package.json exists
    IfFileExists "$INSTDIR\resources\app\package.json" 0 InstallError
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
