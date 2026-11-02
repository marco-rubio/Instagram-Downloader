## ADDED Requirements

### Requirement: A switch turns the push on and off

The "Archive export" dialog SHALL have a switch, "Send exports to the archive
app". While it is off, exports SHALL download as files and no request SHALL go to
the app, and the endpoint and token SHALL stay saved. The switch SHALL apply as
soon as it is changed, without Save and without saving any unsaved endpoint or
token edit. It SHALL be stored with the push settings in `chrome.storage.local`
and SHALL count as on when never set, so settings saved before it existed keep
pushing.

#### Scenario: Switched off

- **WHEN** the switch is off and an export finishes
- **THEN** the ZIP is downloaded, no request goes to the app, and the token is
  still there when the dialog is reopened

#### Scenario: Switched back on

- **WHEN** the switch is turned on again with a token saved
- **THEN** the next export is sent to the app, with no token re-entry

## MODIFIED Requirements

### Requirement: An export is pushed only when an endpoint is configured

A finished export ZIP SHALL be sent, when the push settings hold an endpoint URL
and a token and the switch is on, to the app instead of being downloaded.
Otherwise the export SHALL be downloaded exactly as before, with no request to any
endpoint. The default endpoint offered is `http://127.0.0.1:47821`.

#### Scenario: No endpoint configured

- **WHEN** an export finishes and no endpoint is set
- **THEN** the ZIP is downloaded and no push is attempted

#### Scenario: Endpoint configured

- **WHEN** an export finishes with an endpoint and token set and the switch on
- **THEN** the ZIP is sent to `<endpoint>/ingest` and not downloaded
