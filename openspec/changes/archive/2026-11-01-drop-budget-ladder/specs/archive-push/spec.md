## REMOVED Requirements

### Requirement: The budget ladder sizes the app's reservation

**Reason**: The app reserves no memory ahead of a push, so stepping the budget up
saved nothing and cost extra uploads.

**Migration**: One upload under the app's `max`, see "One upload per export,
within the app's limit".

## ADDED Requirements

### Requirement: One upload per export, within the app's limit

Each push SHALL be a single `POST /ingest`, without `X-Igexport-Budget` and
without retries. When the ZIP is larger than the cached `max` from `/health`, the
upload SHALL be skipped and the ZIP downloaded with a notice that it is too large
for the app. A `413` SHALL be final: the ZIP is downloaded with the app's message.

#### Scenario: A 100 MiB ZIP

- **WHEN** a 100 MiB ZIP is pushed and the app's `max` is 364904448
- **THEN** one request is sent, with no budget header, and it is accepted

#### Scenario: A ZIP above the limit

- **WHEN** the ZIP is larger than the cached `max`
- **THEN** no upload is attempted and the ZIP is downloaded with a notice

## MODIFIED Requirements

### Requirement: The progress ring tracks the upload and never finishes early

During a push the ring SHALL follow building the ZIP, then restart at 0 and
follow the upload's sent bytes up to 95%, and SHALL complete only on a 2xx.

#### Scenario: The upload is refused

- **WHEN** the app refuses the upload
- **THEN** the ring does not complete on the refusal; the ZIP is downloaded and
  only then does the ring complete

### Requirement: The health check is cached for the session

`GET <endpoint>/health`, with the token, SHALL be called at most once per page
session before the first push, and by "Test connection". Its JSON `max` and
`library` SHALL be cached; a `413` body's `max` SHALL replace the cached `max`.

#### Scenario: The limit was lowered

- **WHEN** a push is refused with a `max` lower than the cached one
- **THEN** the cached `max` takes the new value, and that export is downloaded
