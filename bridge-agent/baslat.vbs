' VetZimo Bakanlik Koprusu: ajani pencere acmadan baslatir.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
node = CreateObject("WScript.Shell").ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
CreateObject("WScript.Shell").CurrentDirectory = dir
CreateObject("WScript.Shell").Run """" & node & """ """ & dir & "\agent.mjs""", 0, False
