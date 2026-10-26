# Custom export specs

Custom features of this fork (`my-branch`) built on top of upstream [HOAIAN2/Instagram-Downloader](https://github.com/HOAIAN2/Instagram-Downloader) v6.

The previous implementation (on top of upstream v5.1.12) is kept for reference on branch `my-branch-v5`.

The consumer of the export is the importer in `marco-rubio/instagram-archive`. Contract changes are agreed with it first.

## Goals

- Export a post as a single ZIP that the importer can ingest.
- Loose media files are not enough: the importer needs the metadata next to the media.
- Keep the custom code self-contained, so syncing with upstream causes as few conflicts as possible and the export keeps working if upstream changes or drops similar features.
- No custom naming logic: names come from upstream's filename token settings. Only the format marker is fixed in code.

## Export button

- Inline button with its own icon (archive box), placed right after upstream's inline post download button on every post: feed, post page, reels, single media and carousels.
- Stories: placed right after upstream's story download button. Exports only the story item on screen. Not shown on highlights yet.
- It attaches to upstream's button instead of finding the action bar itself, so upstream's files stay unchanged. It is shown wherever upstream shows its inline post buttons (download button style "Modern" or "Both").
- Shows upstream's progress ring while exporting. On failure it shows a red ring for 3 seconds, with the reason in its tooltip.
- Code: `src/js/igexport.js`, `src/style/igexport.css`. The only upstream file touched is `manifest.json`.

## Post export ZIP, format version 2

### Layout

With upstream's default post tokens (`#username`, `#id`, `#date`):

```
username_<postId>_<date>.zip
|-- igexport                                 format marker, contains "2"
|-- igexport-kind                            "post"
|-- igexport-provenance                      export time and build, JSON
|-- username_<itemId>_<date>.<ext>           media, one per slide
|-- username_<postId>_<date>.txt             caption
|-- username_<postId>_<date>.json            post object
`-- username_<postId>_<date>.profile.<ext>   author's profile picture
```

Archive comment: `igexport v2`.

### Format marker

- Entry name `igexport`, no extension, at the ZIP root.
- Contents: the format version as one ASCII decimal number, nothing else (no newline).
- This format is version `2`. Absent or empty means version 1, the v5 format below.
- The importer refuses versions it does not know. Any incompatible change to this contract bumps the version, never reuse a number.
- The archive comment `igexport v2` is for humans (`unzip -z`). The marker entry is the contract.

### Kind

- Entry `igexport-kind`, no extension. Contents: one bare ASCII word, nothing else (no newline): `post` or `story`.
- Absent means `post` (the first v2 exports did not have it). Unknown word: the importer refuses.
- Separate from the version: `igexport` says how to read the container, `igexport-kind` says what is inside. A new kind does not bump the version.
- The importer currently refuses `story` with "this build imports posts only". Not missing information (story items have their own `code` = encoded `pk`, and `product_type` `story`), but missing schema: stories link as `/stories/<username>/<pk>/` and have an expiry, and get their own tables there, backlogged. The export ships stories anyway, the kind entry keeps them from being read as posts.

### Provenance

Entry `igexport-provenance`, JSON, pretty-printed with 2-space indentation:

```json
{
  "exported_at": "2026-10-25T14:03:09.123Z",
  "extension_version": "6.0.5-igexport.1",
  "upstream_version": "6.0.5",
  "source": "PolarisPostRootQuery"
}
```

| Field               | Content                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `exported_at`       | Export time, RFC 3339 in UTC with explicit offset (`Z`), from `Date.toISOString()`.      |
| `extension_version` | This fork's build, manifest `version_name`. Diagnostics only.                            |
| `upstream_version`  | Upstream version this build is based on, manifest `version`. Diagnostics only.           |
| `source`            | Where the post object came from: `PolarisPostRootQuery`. Diagnostics only.               |

- `exported_at` is the only field the importer consumes: it orders captures of the same post (newest caption and counters win). Without it the importer falls back to the ZIP's file modification time, which copying or syncing can change.
- `exported_at` must always carry an explicit offset. Never a naive local time.
- Nothing the post object already states (shortcode, ids, username, media order or types): a second copy could disagree with it.
- If the entry is missing or unparseable the ZIP still imports, using the file modification time.

### Entry rules

The importer finds entries by extension and by item id, not by name:

| Entry           | Rule                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------- |
| Marker          | `igexport`, without extension. Fixed in code, never configurable.                            |
| Kind            | `igexport-kind`, without extension. Fixed in code.                                           |
| User            | `igexport-user`, without extension, stories only, see Story export ZIP.                      |
| Provenance      | `igexport-provenance`, without extension. Fixed in code.                                     |
| Post object     | The only `.json` entry. Never add a second `.json`.                                          |
| Caption         | The only `.txt` entry. Ignored by the importer.                                              |
| Media           | One entry per slide. Each name **must contain its own item id** (see Naming).                |
| Profile picture | Optional. If present, the only entry whose name without its last extension ends with `.profile`. |

- "Carries its item id" means `String(pk)` is contained anywhere in the entry name: not a prefix, suffix or `_`-segment match. The export validates and the importer matches with this same predicate. Tightening it on either side is agreed with the other first.
- The importer pairs the slide ids from the post object 1:1 with media entries. Two entries with one id, or a slide id no entry carries, refuses the ZIP with the file named.
- The `.profile.<ext>` suffix is **required** for the profile picture. The importer excludes the entry whose stem ends with `.profile` before matching slide ids: for a single-media post both the media and the picture are named after the post pk, so without the suffix the slide would match two entries and the ZIP is refused. Matched on the end of the stem, not anywhere: `my.profile.page_<itemId>.jpg` is media.
- The picture is never renamed (no `_2` on a name collision): if its name is taken it is left out. It is full size or absent, never a thumbnail.
- Entries without an extension are reserved for the export (`igexport*`). The importer ignores every extensionless entry except reading `igexport`, so new ones can be added without a format bump.
- Extensionless names must contain **no dot anywhere**: the importer splits the extension at the last `.`, so a dot would turn the entry into media and refuse the ZIP.
- Any other entry with an extension would be a second leftover and refuse the ZIP. New kinds are agreed with the importer first.

### Naming

Names come from upstream's filename settings for the post scope (settings dialog, "File name templates"), never from custom logic in the export:

| Entry           | Name                                                  |
| --------------- | ----------------------------------------------------- |
| Archive         | Upstream archive name (`getArchiveFileName`), `.zip`  |
| Media           | Upstream media name (`getMediaFileName`)              |
| Caption         | Archive base name + `.txt`                            |
| Post object     | Archive base name + `.json`                           |
| Profile picture | Archive base name + `.profile.<ext>`                  |

- The only requirement: the post tokens include `#id`. For media, `#id` is the slide's numeric id: `carousel_media[i].pk` for a carousel, the post's `pk` for single media. Upstream's default tokens already include it.
- Without `#id`, media names carry no item id (and may collide, upstream then appends `_2`, `_3`), so the importer refuses the ZIP. A wrong config fails loudly, it never imports wrongly.
- Upstream cuts names at 180 characters, so a long `#title` before `#id` can cut the id off. The export checks every media name contains its item id, before downloading and again on the final name, and otherwise fails with the cause in the button's tooltip instead of saving a ZIP the importer refuses. It never shortens names itself.
- Slide order is not in the names. It is the order of `carousel_media` in the post object.
- Token order and other tokens do not matter to the importer. It never reads the ZIP's own name.

### Content

| Entry           | Content                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| Media           | Highest quality available, one file per slide. A slide is never silently skipped.                     |
| Caption         | Raw caption text, trimmed. Always present, empty when the post has no caption.                        |
| Post object     | Raw post object as returned by Instagram, unmodified, pretty-printed with 2-space indentation.        |
| Profile picture | Full size only, from `user.hd_profile_pic_url_info.url`. Never `profile_pic_url` (150x150 thumbnail). |

- Media extension follows the content type (`.jpg`, `.webp`, `.mp4`, ...), as upstream names it.
- Photo resolution depends on upstream's `setPreferredMediaResolutionCookies()` (`wd` / `dpr` cookies), which `getPostPhotos()` sets before the query. Deliberate, keep it: without it Instagram serves a downscaled candidate. Measured on the same slide: v1 delivered 1080x1080 (181 KB) while the post object stated `original_width` / `original_height` 2048, v2 delivers the full 2048x2048 (741 KB). Videos are byte-identical.
- If any slide cannot be downloaded, the export fails instead of saving an incomplete ZIP: the importer checks the media count against the slides.
- The profile picture comes from the CDN URL already in the post object, so it costs no extra API call. If its download fails, the ZIP is still saved without it. A thumbnail is never saved in its place.

### Post object fields the importer reads

The importer reads these keys literally, with REST spellings:

- Required: `pk`, `user.pk` (or `user.pk_id`), `user.username`, `carousel_media[].pk` for carousels.
- Wanted, silently lost if renamed: `taken_at` (unix seconds), `media_type`, `product_type`, `code`, `caption.text`, `location.name` / `lat` / `lng`, `usertags.in[].user.pk`, `coauthor_producers[].pk` / `username`, and per slide `original_width`, `original_height`, `video_duration`.

GraphQL-style renames (`edge_sidecar_to_children`, `dimensions`, `owner.id`, `shortcode`, `taken_at_timestamp`) would import as empty values without an error.

Verified on two real exports (single video, and a photo + video carousel compared with its v1 REST export): `PolarisPostRootQuery` returns the same v1 post object with REST spellings and a smaller field selection (81 top-level keys vs 115-135). Present: every required field, `taken_at` in seconds, `original_width` / `original_height` on the post object and on each `carousel_media` entry. Missing: `video_duration` everywhere, plus `play_count` / `ig_play_count` and other non-contract fields. The importer derives the duration from `video_dash_manifest` (`mediaPresentationDuration`, matches `video_duration` within 2 ms on 407 of 416 v1 videos). The export keeps the post object unmodified and never fills fields in.

## Story export ZIP

Same format version 2 and the same rules as the post export, with `igexport-kind` `story`. One ZIP per story item: the one on screen. It is identified by the story id in the URL (`/stories/<username>/<storyId>/`). The first story of a reel has no id in the URL (`/stories/<username>/`): then the media on screen is matched against the story items with upstream's `findMediaByRenderedUrl()` (id in the media URL's cache key, then URL path), read before any request since the story keeps playing. No position or index fallback: if neither identifies the story, the export fails instead of guessing.

```
username_<storyId>.zip
|-- igexport                        "2"
|-- igexport-kind                   "story"
|-- igexport-provenance             source "PolarisStoriesV3ReelPageGalleryQuery"
|-- igexport-user                   only if the story item's `user` has no `username`
|-- username_<storyId>.<ext>        the story item's media
|-- username_<storyId>.txt          caption text, usually empty
`-- username_<storyId>.json         the raw story item
```

- Names come from upstream's **Stories** filename template (separate from Posts). `#id` is the story item's `pk` for the media, and also for the archive and sidecars: the export passes the story item, not the reel, as what is being named. Upstream's own story ZIP uses the reel id (the user's pk) there, which would give every story of one account the same name.
- `.json`: the raw story item (one element of the reel's `items[]`), unmodified. Never trimmed or wrapped.
- `igexport-user`: the reel's `user` object, unmodified, JSON. Only when the story item's `user` has no `username` (one source per fact). Story items carry a stub `user` with `pk` but no `username` and no picture, so in practice it is always added. The importer needs its `pk` (or `pk_id`) and `username`.
- When `igexport-user` is present the importer reads the account from it as a whole. If the item's `user.pk` is also present and disagrees with it, the importer refuses: identity assembled from two contradicting entries is never guessed. Both are the author's account pk, so this should not happen.
- No profile picture: the story item's and the reel's `user` only carry the 150x150 thumbnail, and the full-size one would need a heavily rate-limited user info request. The importer treats the picture as optional.

## Format version 1 (v5, branch `my-branch-v5`)

Still accepted by the importer, identified by the missing marker.

```
username [shortcode].zip
|-- username [shortcode].jpeg | .mp4          single media
|-- username [shortcode] - 1.jpeg, - 2.mp4    carousel media, 1-based position
|-- username [shortcode].txt
`-- username [shortcode].json
```

- Images always `.jpeg`, videos `.mp4`.
- Post object from REST `/api/v1/media/{id}/info/`, in version 2 from GraphQL `PolarisPostRootQuery`.
- No profile picture.

## Open questions

- [ ] Story with a reshared post (`story_feed_media` / `reshared_story_media_author` set): send a sample to the importer when one appears.
- [ ] How stories fit the archive: own tables on the importer side, backlogged. First story sample: the item has its own `code`, equal to the encoded `pk` as for posts; `taken_at` and `expiring_at` (+24 h) in seconds; `video_duration` present (unlike posts); `product_type` `story`; stub `user` (pk only); no reshared post (`story_feed_media` null); link and music stickers present.
- [ ] Highlights export: later. Upstream's highlight buttons do not show consistently yet.
- [ ] Standalone profile picture button (v5: profile pages only, read from page data, named `username [userId_YYYYMMDDHHmmssZ].jpeg`): keep or drop.
