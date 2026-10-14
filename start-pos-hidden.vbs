' Starts the register with no console window. Used by the desktop icon and the auto-start entry.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
sh.Environment("Process")("POS_HIDDEN") = "1"
sh.Run "cmd /c node launch.mjs", 0, False
