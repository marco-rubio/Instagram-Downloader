# Custom export specs

Custom features of this fork (`my-branch`) built on top of upstream [HOAIAN2/Instagram-Downloader](https://github.com/HOAIAN2/Instagram-Downloader) v6.

The previous implementation (on top of upstream v5.1.12) is kept for reference on branch `my-branch-v5`.

## Goals

- Export a post as a single ZIP that an external importer can ingest.
- Loose media files are not enough: the importer needs the description and metadata next to the media.
- Keep the custom code self-contained, so syncing with upstream causes as few conflicts as possible and the export keeps working if upstream changes or drops similar features.

## Post export ZIP

### Layout

```
username_<postId>.zip
|-- username_<itemId>.<ext>          media, one per item
|-- username_<postId>.txt            description
|-- username_<postId>.json           metadata
`-- username_<postId>.profile.<ext>  author's profile picture
```

The internal file-type layout (media + `.txt` + `.json` + `.profile.<ext>`) is what the importer relies on and must be kept.

### Naming

Names follow upstream's filename tokens `#username` + `#id`, joined with `_`.

| File                | Name                                                             |
| ------------------- | ---------------------------------------------------------------- |
| Archive             | `username_<postId>.zip`                                          |
| Media               | `username_<itemId>.<ext>`, named by upstream                     |
| Description         | `username_<postId>.txt`                                          |
| Metadata            | `username_<postId>.json`                                         |
| Profile picture     | `username_<postId>.profile.<ext>`                                |

- `<postId>` is the post's numeric id (`pk`), not the shortcode. The shortcode is available in the metadata as `code`.
- `<itemId>` is each media item's numeric id. For a single-media post it equals `<postId>`.
- Carousel order is not encoded in the names. The order is in the metadata, `carousel_media`.
- Usernames can contain `_`, so the id is everything after the **last** `_`.

### Content

| File            | Content                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------- |
| Media           | Highest quality available, photos and videos in post order.                                   |
| Description     | Raw caption text, trimmed. Always present, empty when the post has no caption.                |
| Metadata        | Raw post object as returned by Instagram, unmodified, pretty-printed with 2-space indentation. |
| Profile picture | Author's profile picture from `user.hd_profile_pic_url_info`, falling back to `user.profile_pic_url`. |

- The profile picture is downloaded from the CDN using the URL already in the post object, so it costs no extra API call.
- If the profile picture download fails, the ZIP is still saved without it.

### Differences from the v5 format

The v5 export (branch `my-branch-v5`) used a filename template:

```
username [shortcode].zip
|-- username [shortcode].jpeg | .mp4          single media
|-- username [shortcode] - 1.jpeg, - 2.mp4    carousel media
|-- username [shortcode].txt
`-- username [shortcode].json
```

- Names used the shortcode in brackets, now the numeric post id.
- Carousel items were numbered, now named by item id.
- Images were always `.jpeg`, now the extension follows the content type (`.jpg`, `.webp`, ...).
- The metadata came from the REST endpoint `/api/v1/media/{id}/info/`, now from upstream's GraphQL `PolarisPostRootQuery`. The shape still needs to be compared, see open questions.
- There was no profile picture.

## Open questions

- [ ] Where the export button goes: separate inline button, upstream's ZIP button, or a floating button.
- [ ] Whether the metadata from GraphQL has the same shape as the v5 REST metadata the importer reads.
- [ ] Force `.jpeg` / `.mp4` extensions inside the export ZIP, or keep upstream's content-type extensions.
- [ ] Stories and highlights export: needed, and with which sidecars (no caption).
- [ ] Standalone profile picture button (v5: profile pages only, read from page data, named `username [userId_YYYYMMDDHHmmssZ].jpeg`): keep or drop.
