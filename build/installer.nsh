; P14 per-user installer: never kill a running application or erase user data.
!macro customCheckAppRunning
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${If} $R0 != 603
    IfSilent +2 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Please save your work and close Career Assistant before installing or uninstalling. No process was terminated."
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!macro customUnInit
  ClearErrors
  ${GetParameters} $R0
  ${GetOptions} $R0 "--delete-app-data" $R1
  ${IfNot} ${Errors}
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend
