# post-export Specification

## Purpose

What a post export (`igexport-kind` `post`) captures and puts in the
container described by `export-archive-format`: feed posts, post pages, reels,
single media and carousels. The post object comes from upstream's
`getPostPhotos()` (GraphQL `PolarisPostRootQuery`), one request per export.

## Requirements

### Requirement: One request fetches the post object

The export SHALL fetch the post object once with upstream's `getPostPhotos()`
and build both the media list and the `.json` entry from that one object, so
an export costs one Instagram data request. Provenance `source` SHALL be
`PolarisPostRootQuery`. Upstream sets the resolution cookies (`wd`, `dpr`)
before that query, which makes Instagram serve full-resolution photos; the
export SHALL keep going through `getPostPhotos()` so this keeps applying.

#### Scenario: A carousel is exported

- **WHEN** the export button of a carousel is clicked
- **THEN** exactly one post query is sent, followed by the media downloads

#### Scenario: The post is not found

- **WHEN** `getPostPhotos()` returns nothing
- **THEN** the export fails with "post not found"

### Requirement: The post object is shipped raw

The `.json` entry SHALL be the post object exactly as Instagram returned it,
unmodified and pretty-printed with 2-space indentation. The export SHALL NOT
fill in, rename or trim fields. The importer reads REST spellings literally
(`pk`, `user.pk`, `user.username`, `carousel_media[].pk`, `taken_at`,
`caption.text`, ...); `PolarisPostRootQuery` returns them with those spellings,
without `video_duration`, which the importer derives from
`video_dash_manifest`.

#### Scenario: A video post is exported

- **WHEN** the post object has no `video_duration`
- **THEN** the `.json` entry still has none

### Requirement: Media follow the post's slides

There SHALL be one media entry per slide, in the order of `carousel_media`
(the post itself for single media), and each media name's `#id` SHALL be the
slide's own pk. Slide order SHALL NOT be encoded in names: it is the order in
the post object.

#### Scenario: A three-slide carousel

- **WHEN** a carousel with three slides is exported
- **THEN** the ZIP holds three media entries, each named with its slide's pk

### Requirement: Caption and profile picture accompany the media

The `.txt` entry SHALL hold the caption text, trimmed, and SHALL be present
and empty when the post has no caption. The author's full-size profile picture
SHALL be added from the post object's `user` when it downloads, at no extra
data request (the URL is in the post object).

#### Scenario: A post without caption

- **WHEN** a post without caption is exported
- **THEN** the ZIP holds an empty `.txt` entry
