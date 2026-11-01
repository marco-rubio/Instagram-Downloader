# story-export Specification

## Purpose

What a story export (`igexport-kind` `story`) captures: the one story item on
screen, never the whole reel, in the container described by
`export-archive-format`. Highlights are not supported.

```
username_<storyId>.zip
|-- igexport                  "2"
|-- igexport-kind             "story"
|-- igexport-provenance       source "PolarisStoriesV3ReelPageGalleryQuery"
|-- igexport-user             the reel's user, when the item lacks a username
|-- username_<storyId>.<ext>  the item's media
|-- username_<storyId>.txt    caption text, usually empty
`-- username_<storyId>.json   the raw story item
```

## Requirements

### Requirement: Only the story on screen is exported

The export SHALL produce one ZIP for the story item currently shown on
`/stories/<username>/<storyId>/`, found by its id in the reel returned by
upstream's `getUserIdFromSearch()` and `getStoryPhotos()`. Highlights
(`/stories/highlights/...`) SHALL NOT be exported.

#### Scenario: A story with its id in the URL

- **WHEN** the export runs on `/stories/<username>/<storyId>/`
- **THEN** the ZIP holds only that story item

#### Scenario: The story expired meanwhile

- **WHEN** the id in the URL is not among the reel's current items
- **THEN** the export fails saying the story is not in the current stories

### Requirement: The first story is matched by its media, never by position

The export SHALL identify the first story of a reel, which has no id in the URL
(`/stories/<username>/`), from its media: it SHALL read the media on screen
before any request (the story keeps playing and can advance), waiting until two
consecutive frames agree, and SHALL
match it against the items with upstream's `findMediaByRenderedUrl()` on the
media URL, then the video poster. There SHALL be no index or position fallback:
if nothing matches, the export fails instead of guessing.

Known limitation: a first story that is a video playing from a `blob:` URL
without a poster cannot be identified, so its export fails.

#### Scenario: A first-story photo

- **WHEN** the export runs on `/stories/<username>/` showing a photo
- **THEN** the item whose media URL matches the one on screen is exported

#### Scenario: A first-story blob video without poster

- **WHEN** the media on screen is a `blob:` video without a poster
- **THEN** the export fails with "cannot match the story on screen to the
  current stories"

### Requirement: The story item is shipped raw, with its user when needed

The `.json` entry SHALL be the raw story item (one element of the reel's
`items[]`), unmodified. Story items carry a stub `user` without `username`, so
when the item's `user` has no `username` the export SHALL add `igexport-user`
with the reel's `user` object, unmodified; otherwise it SHALL NOT, one source
per fact.

Names SHALL come from upstream's Stories template, with the story item (not the
reel) as what is named, so `#id` is the item's pk for the archive, the media and
the sidecars. The `.txt` entry SHALL hold the item's caption text, trimmed,
usually empty. There SHALL be no profile picture: story users only carry the
thumbnail, and the full-size one would need a rate-limited user request.

#### Scenario: A story item with a stub user

- **WHEN** the item's `user` has a pk but no username
- **THEN** the ZIP holds `igexport-user` with the reel's user, and no
  `.profile.<ext>` entry
