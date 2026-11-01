# profile-export Specification

## Purpose

What a profile export (`igexport-kind` `profile`) captures: an account's user
record and full-size profile picture, from its profile page (`/<username>/`
and its tabs), in the container described by `export-archive-format`. It makes
no Instagram data request: the record is read from what the page already
loaded.

```
username_<userPk>.zip
|-- igexport                         "2"
|-- igexport-kind                    "profile"
|-- igexport-provenance              source "profile-page-data"
|-- username_<userPk>.json           the user record
`-- username_<userPk>.profile.<ext>  full-size profile picture
```

## Requirements

### Requirement: The user record is read from the page, never requested

The export SHALL ask `igexport-profile-handler.js` (MAIN world) for the user
record through the `igexportProfileRequest` / `igexportProfileResponse`
window events, carrying JSON strings in both directions. The handler SHALL walk
the profile header's React data and SHALL read only own data properties, never
invoking a getter (some Instagram objects run code on access, which opened
stories). Provenance `source` SHALL be `profile-page-data`. If the page does not
answer within 2 seconds, the export fails asking to reload the page.

#### Scenario: The extension was reloaded but the tab was not

- **WHEN** the handler does not answer within 2 seconds
- **THEN** the export fails with "the page did not answer, reload the page"

### Requirement: The record is chosen deterministically

The handler SHALL take the first record in the header's data whose `username`
matches the page and that has `hd_profile_pic_url_info.url`, and nothing else:
never "the richest" record, whose shape would follow Instagram's frontend
rather than the account. The record SHALL be shipped raw and self-contained:
functions and DOM nodes are left out, and a cycle or anything nested deeper
than 12 levels is cut; nothing else is removed or added. A record referencing other store records (`__ref`) SHALL
fail the export as not supported yet.

The importer requires `pk` (or `pk_id` / `id`) and `username`. Keys that change
on their own (`is_unpublished`, `live_broadcast_id`,
`live_broadcast_visibility`) are not used when comparing two records.

#### Scenario: The viewer's own record is also on the page

- **WHEN** the page data holds the viewer's and suggested users' records too
- **THEN** only the record with the page's username is exported

#### Scenario: The record has no pk

- **WHEN** the chosen record has none of `pk`, `pk_id` or `id`
- **THEN** the export fails with "the user record has no pk"

### Requirement: The full-size picture is required

The profile export SHALL include the full-size picture from
`hd_profile_pic_url_info.url` and SHALL fail if it cannot be downloaded: never
a thumbnail, never a fallback request. Names SHALL come from upstream's Posts
template with the account pk as `#id`; tokens without a value (`#date`,
`#title`) drop out. There SHALL be no `.txt` entry and no media entries.

#### Scenario: The picture download fails

- **WHEN** the full-size picture cannot be downloaded
- **THEN** no ZIP is saved, and the failure says the full-size profile picture
  could not be downloaded
