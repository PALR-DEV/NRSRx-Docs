# NRSRx Documentation Site

This folder contains the [Docusaurus](https://docusaurus.io/) documentation site for the
NRSRx framework. All documentation content lives in [`docs/`](./docs).

## Develop

```bash
cd website
npm install
npm start        # local dev server with hot reload at http://localhost:3000
```

## Build

```bash
npm run build    # produces a static site in ./build
npm run serve    # serve the production build locally
```

## Structure

```
website/
├── docs/                 # all documentation markdown (the content)
│   ├── intro.md          # served at the site root (/)
│   ├── getting-started.md
│   ├── concepts/         # architecture, config, auth, versioning, swagger
│   ├── flavors/          # webapi, odata, signalr
│   ├── data/             # models & interfaces, EF, SimpleMapper
│   ├── eventing/         # eventing overview, publishers, jobs
│   ├── logging/
│   ├── testing/
│   └── reference/        # packages, best practices
├── src/css/custom.css    # theme overrides
├── static/img/           # logo & favicon
├── docusaurus.config.js  # site configuration
└── sidebars.js           # hand-curated sidebar / reading order
```

## Editing

- Add a new page by creating a markdown file under `docs/` and adding its id to
  `sidebars.js`.
- Each page uses front matter (`id`, `title`, `sidebar_label`) at the top.
- Internal links use relative paths to the `.md` files so they're validated at build time.
