## MODIFIED Requirements

### Requirement: A button shows progress and failure itself

While exporting, a button SHALL show upstream's progress ring
(`setInlineDownloadProgress`) and SHALL ignore clicks. On success the ZIP SHALL
be pushed to the archive app when an endpoint is configured (`archive-push`), and
otherwise saved through upstream's `saveFile`. On failure the button SHALL show a
red ring for 3 seconds with `Export failed: <reason>` as its tooltip, then return
to its label; the error is also logged to the console. A failed push is not an
export failure: the ZIP is downloaded and the reason shown as a notice.

#### Scenario: An export fails

- **WHEN** an export throws
- **THEN** the button turns red for 3 seconds and its tooltip names the reason

#### Scenario: A push fails

- **WHEN** the ZIP was built but the app refused it
- **THEN** the button does not turn red, the ZIP is downloaded and a notice
  gives the app's reason
