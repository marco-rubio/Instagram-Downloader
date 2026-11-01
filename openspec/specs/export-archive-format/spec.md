# export-archive-format Specification

## Purpose

The ZIP container every export produces, format version 2, shared by the
post, story and profile kinds. It is the contract with the importer in
`marco-rubio/instagram-archive`: the importer identifies and reads a ZIP from
its contents alone, never from its file name. What each kind puts inside is in
the `post-export`, `story-export` and `profile-export` specs.

Layout with upstream's default post tokens (`#username`, `#id`, `#date`):

```
username_<postId>_<date>.zip
|-- igexport                                 format marker, "2"
|-- igexport-kind                            "post" | "story" | "profile"
|-- igexport-provenance                      export time and build, JSON
|-- username_<itemId>_<date>.<ext>           media, one per item
|-- username_<postId>_<date>.txt             caption
|-- username_<postId>_<date>.json            the raw object
`-- username_<postId>_<date>.profile.<ext>   profile picture
```

Format version 1 is the v5 export (branch `my-branch-v5`), still accepted by
the importer and recognised by the missing marker:

```
username [shortcode].zip
|-- username [shortcode].jpeg | .mp4          single media
|-- username [shortcode] - 1.jpeg, - 2.mp4    carousel media, 1-based position
|-- username [shortcode].txt
`-- username [shortcode].json
```

In v1, images are always `.jpeg` and videos `.mp4`, the post object comes from
REST `/api/v1/media/{id}/info/`, and there is no profile picture.

## Requirements

### Requirement: The format marker names the container version

Every export SHALL carry an entry `igexport` at the ZIP root, without
extension, whose contents are the format version as one ASCII decimal number
and nothing else (no newline). This format is version `2`. An absent or empty
marker means version 1, the v5 format (branch `my-branch-v5`).

Any incompatible change to this contract SHALL bump the version, and a version
number SHALL NOT be reused. The archive comment SHALL be `igexport v2`, for
humans reading the ZIP (`unzip -z`); the marker entry is the contract, never
the comment.

#### Scenario: A v2 export is opened

- **WHEN** the importer reads a ZIP made by this build
- **THEN** the `igexport` entry contains exactly `2`, and the archive comment is
  `igexport v2`

#### Scenario: A v5 export is opened

- **WHEN** the importer reads a ZIP without an `igexport` entry
- **THEN** it is read as format version 1

### Requirement: The kind entry says what is inside

Every export SHALL carry an entry `igexport-kind`, without extension, whose
contents are one bare ASCII word and nothing else: `post`, `story` or
`profile`. An absent kind means `post`, because the first v2 exports did not
have it. A new kind SHALL NOT bump the format version: `igexport` says how to
read the container, `igexport-kind` says what is inside.

The kind SHALL NOT appear in the ZIP's file name. ZIP names may clash across
kinds (a profile ZIP and upstream's story-group ZIP are both named after the
account pk); the browser's duplicate suffixes keep the files apart.

#### Scenario: A story is exported

- **WHEN** a story is exported
- **THEN** `igexport-kind` contains exactly `story`, and the ZIP name carries no
  kind

### Requirement: Provenance records when and by which build the capture was taken

Every export SHALL carry an entry `igexport-provenance`, without extension,
holding a JSON object pretty-printed with 2-space indentation:

| Field | Content |
|---|---|
| `exported_at` | Capture time, RFC 3339 in UTC with explicit `Z`, from `Date.toISOString()`. |
| `extension_version` | This fork's build, manifest `version_name`. Diagnostics only. |
| `upstream_version` | Upstream version the build is based on, manifest `version`. Diagnostics only. |
| `source` | Where the raw object came from, set by the kind. Diagnostics only. |

`exported_at` SHALL be taken the moment the raw object is captured, before
any media download, and SHALL always carry an explicit offset. It is the only
field the importer consumes: it orders captures of the same item, and the
importer prefers it over the file's modification time. Provenance SHALL NOT
repeat anything the raw object already states (ids, username, media order or
types): a second copy could disagree with it.

#### Scenario: A post is exported

- **WHEN** the post object has been fetched and its media are still downloading
- **THEN** `exported_at` is already fixed to the moment the object arrived, in
  UTC with a `Z` suffix

### Requirement: Entries are found by extension and item id, not by name

The ZIP SHALL obey these entry rules, which the importer relies on:

| Entry | Rule |
|---|---|
| Marker, kind, provenance, user | `igexport`, `igexport-kind`, `igexport-provenance`, `igexport-user`. Fixed in code, never configurable. |
| Raw object | The only `.json` entry. |
| Caption | The only `.txt` entry, when the kind has one. |
| Media | One entry per item, each name containing its own item id. |
| Profile picture | Optional; the only entry whose name without its last extension ends with `.profile`. |

Extensionless entries SHALL be reserved for the export (`igexport*`) and SHALL
contain no dot anywhere, because the importer splits the extension at the last
dot. The profile picture SHALL keep its `.profile.<ext>` suffix and SHALL NOT be
renamed on a collision (no `_2`): if its name is taken it is left out. No other
entry with an extension SHALL be added without first agreeing it with the
importer.

#### Scenario: A single-media post with a profile picture

- **WHEN** the media and the profile picture are both named after the post pk
- **THEN** only the picture's stem ends with `.profile`, so the importer can
  exclude it before matching the slide id

### Requirement: Names come from upstream's filename templates

The archive, media, caption, raw object and profile picture names SHALL come
from upstream's filename template settings, never from naming logic of the
export: the archive name from `getArchiveFileName`, media names from
`getMediaFileName`, and the caption, raw object and picture from the archive
base name plus `.txt`, `.json` and `.profile.<ext>`. Repeated media names get
upstream's `getUniqueArchiveEntryName` suffix.

The only requirement on the templates is that they include `#id`. The export
SHALL check, before downloading and again on the final name, that every media
name contains its item id (`String(pk)` anywhere in the name), and SHALL
otherwise fail with the cause instead of saving a ZIP the importer would
refuse. The export SHALL NOT shorten names itself (upstream cuts them at 180
characters, which can cut `#id` off after a long `#title`).

#### Scenario: The template lacks #id

- **WHEN** a post is exported with a Posts template without `#id`
- **THEN** no ZIP is saved, and the failure says to add `#id` to the Posts
  template

#### Scenario: A long title cuts the id off

- **WHEN** the 180-character limit removes the item id from a media name
- **THEN** no ZIP is saved, and the failure says to move `#id` before `#title`

### Requirement: Media are complete and full quality

Each media item SHALL be downloaded at the highest quality upstream offers
(`fetchBestMediaBlob`), with the extension following the content type. An item
without downloadable media, or a download that fails, SHALL fail the whole
export: an incomplete ZIP is never saved, because the importer pairs media 1:1
with items.

A media download, the profile picture included, that is refused with HTTP 429
SHALL be retried once, after 5 seconds, with the same test upstream uses
(`status === 429`, or `(429)` in the message). Instagram's data queries are not
retried: upstream returns nothing on any of their failures, so a rate limit
cannot be told apart from a missing item there, and upstream never retries a
429.

#### Scenario: A video download is rate-limited

- **WHEN** a media download fails with HTTP 429
- **THEN** it is retried once after 5 seconds, and a second failure fails the
  export with that error

#### Scenario: A carousel slide has no media

- **WHEN** one slide of a carousel has no downloadable media
- **THEN** the export fails and no ZIP is saved

### Requirement: The profile picture is full size or absent

When a kind includes the author's profile picture, it SHALL be the full-size
picture from `hd_profile_pic_url_info.url`, and never `profile_pic_url` (a
150x150 thumbnail). If it cannot be downloaded, the ZIP SHALL be saved without
it, unless the kind requires it (`profile-export`).

#### Scenario: The picture download fails on a post

- **WHEN** the post's media downloaded but the profile picture did not
- **THEN** the ZIP is saved without a `.profile.<ext>` entry, and no thumbnail
  takes its place
