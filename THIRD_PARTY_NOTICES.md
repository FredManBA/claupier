# Third-party notices

Claupier is released under the MIT License (see `LICENSE`). It bundles or links the following third-party software. All of it is used unmodified.

## Silkscreen font

The settings window uses the Silkscreen font, distributed through `@fontsource/silkscreen`.

- Copyright 2001 The Silkscreen Project Authors (https://github.com/googlefonts/silkscreen)
- License: SIL Open Font License 1.1 (https://openfontlicense.org)

The pixel fonts drawn on the table itself (`src/core/font.ts`) are original to Claupier.

## Rust crates

The app is built with [Tauri](https://tauri.app) and about 300 Rust crates. Almost all of them are licensed under MIT, Apache-2.0, or both; the rest use BSD-3-Clause, ISC, Zlib, Unicode-3.0, Unlicense or CC0.

Five crates are licensed under the Mozilla Public License 2.0: `cssparser`, `cssparser-macros`, `dtoa-short`, `option-ext` and `selectors`. They are used unmodified, and their source code is available on [crates.io](https://crates.io).

To list every crate and its license:

```
cd src-tauri
cargo metadata --format-version 1
```

## npm packages

- `@tauri-apps/api`: Apache-2.0 OR MIT.
- `@fontsource/silkscreen`: SIL Open Font License 1.1 (see above).
