---
builder: minor
---

`builder hosting install --surface <id>` checks each declared private scope's registry route and runs a frozen install, and it reports a rejected credential, a missing credential, and a mis-routed scope as different errors, while `builder hosting should-build --surface <id>` prints the changed input when the only changed file is the install command.
