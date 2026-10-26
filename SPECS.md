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
- It attaches to upstream's button instead of finding the action bar itself, so upstream's files stay unchanged. It is shown wherever upstream shows its inline post buttons (download button style "Modern" or "Both").
- Shows upstream's progress ring while exporting. On failure it shows a red ring for 3 seconds, with the reason in its tooltip.
- Code: `src/js/igexport.js`, `src/style/igexport.css`. The only upstream file touched is `manifest.json`.

## Post export ZIP, format version 2

### Layout

With upstream's default post tokens (`#username`, `#id`, `#date`):

```
username_<postId>_<date>.zip
|-- igexport                                 format marker, contains "2"
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
| Provenance      | `igexport-provenance`, without extension. Fixed in code.                                     |
| Post object     | The only `.json` entry. Never add a second `.json`.                                          |
| Caption         | The only `.txt` entry. Ignored by the importer.                                              |
| Media           | One entry per slide. Each name **must contain its own item id** (see Naming).                |
| Profile picture | The one entry left over after every slide id is matched to a media entry.                    |

- The importer pairs the slide ids from the post object 1:1 with media entries. Two entries with one id, or a slide id no entry carries, refuses the ZIP with the file named.
- The profile picture's `.profile.<ext>` suffix is only a cross-check for the importer, not the rule.
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
| Profile picture | From `user.hd_profile_pic_url_info.url`, falling back to `user.profile_pic_url`.                      |

- Media extension follows the content type (`.jpg`, `.webp`, `.mp4`, ...), as upstream names it.
- If any slide cannot be downloaded, the export fails instead of saving an incomplete ZIP: the importer checks the media count against the slides.
- The profile picture comes from the CDN URL already in the post object, so it costs no extra API call. If its download fails, the ZIP is still saved without it.

### Post object fields the importer reads

The importer reads these keys literally, with REST spellings:

- Required: `pk`, `user.pk` (or `user.pk_id`), `user.username`, `carousel_media[].pk` for carousels.
- Wanted, silently lost if renamed: `taken_at` (unix seconds), `media_type`, `product_type`, `code`, `caption.text`, `location.name` / `lat` / `lng`, `usertags.in[].user.pk`, `coauthor_producers[].pk` / `username`, and per slide `original_width`, `original_height`, `video_duration`.

GraphQL-style renames (`edge_sidecar_to_children`, `dimensions`, `owner.id`, `shortcode`, `taken_at_timestamp`) would import as empty values without an error.

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

- [ ] Post object shape from GraphQL `PolarisPostRootQuery` vs the REST keys above. Upstream reads REST-style keys from it (`carousel_media`, `taken_at`, `pk`, `user.username`, `caption.text`) and the response key is `xdt_api__v1__media__shortcode__web_info`, which suggests the same v1 object. To be confirmed with a real export sent to the importer.
- [ ] Stories and highlights export: needed, and with which entries.
- [ ] Standalone profile picture button (v5: profile pages only, read from page data, named `username [userId_YYYYMMDDHHmmssZ].jpeg`): keep or drop.
