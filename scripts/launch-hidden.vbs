' Launches the pbscheduling agent with NO visible console window, in the user's
' interactive desktop session (required so the Picklr scraper can use headed Chrome).
' The scheduled task points at this script.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Project root = parent folder of this script's folder (\scripts).
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectDir = fso.GetParentFolderName(scriptDir)

shell.CurrentDirectory = projectDir
' 0 = hidden window, False = don't wait (return immediately).
shell.Run """C:\Program Files\nodejs\node.exe"" """ & projectDir & "\src\index.js""", 0, False
