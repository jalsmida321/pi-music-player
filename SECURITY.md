# Security

## Reporting a vulnerability

Please report security issues privately to the repository owner instead of opening a public issue. Do not include API keys, music files, chat records, or ACRCloud credentials in reports.

## Local data

PI Music Player stores its settings, library index, AI credentials, chat sessions, cached covers, and cached lyrics in the current Windows user's Electron application-data directory. These files are not uploaded by the application except when a configured AI or recognition service is explicitly used.

Users should never commit `%APPDATA%/PI Music Player` or screenshots containing credentials to a public repository.

## Windows installer

Public builds are currently unsigned. Windows SmartScreen may display an "Unknown publisher" warning. A trusted code-signing certificate is required to remove that warning.
