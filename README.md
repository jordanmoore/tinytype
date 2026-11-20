# [tinytype](https://jordanm.co.uk/tinytype/)

The fonts that ship with iOS, Android, macOS and Windows, each shown in its own face, with copy-and-paste font stacks that pair them by role.

## How does it work?

Just [load the URL](https://jordanm.co.uk/tinytype/). The page uses no webfonts: every name is set in the font it names, and it checks which of them are on your device.

To run it locally, serve the folder over http (the page fetches `data/fonts.json`):

    python3 -m http.server

## Updating the table

The table is generated from the platform vendors' own lists, so nothing in `data/fonts.json` is edited by hand.

    python3 scripts/build.py

This fetches Apple's [System Fonts list](https://developer.apple.com/fonts/system-fonts/) (iOS and macOS), the Android Open Source Project's [fonts.xml](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/data/fonts/fonts.xml) and Microsoft's [Windows 11 font list](https://learn.microsoft.com/en-us/typography/fonts/windows_11_font_list), then rewrites `data/fonts.json`. Python 3, no dependencies. Saved copies of the sources can be passed with `--apple`, `--android` and `--windows`.

Only fonts the vendors mark as preinstalled count: not Apple's "downloadable" or "document support" faces, and not Windows' Feature On Demand language packs.

- Facts the vendors don't publish live in `data/meta.json`: which script each font covers, whether it is a sans, serif, mono, display, handwriting, symbol or emoji face, an optional note, and the ready-made stacks. `build.py` merges it in and lists any font with no entry.
- Font family names that need special handling when parsing are listed at the top of `scripts/build.py`.
- Page design and copy live in `index.html`, `css/tinytype.css` and `js/tinytype.js`.

## Known gaps

- Apple's list marks Bodoni 72, Courier and PingFang as not preinstalled on iOS. Earlier iOS font lists included them, so this needs checking on a real device.
- The "on this device" check compares rendering widths against generic fallbacks, so it cannot see a font that is also the system's own fallback for its script. Chromium browsers offer an exact check through the Local Font Access API.
