# NRSRx Documentation Site

[Docusaurus](https://docusaurus.io/) site for the NRSRx framework docs. Content lives in
[`docs/`](./docs).

## Develop

```bash
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
docs/                    # all documentation markdown (the content)
├── intro.md             # served at the site root (/)
├── getting-started.md
├── concepts/            # architecture, config, auth, versioning, swagger
├── flavors/             # webapi, odata, signalr
├── data/                # models & interfaces, EF, SimpleMapper
├── eventing/            # eventing overview, publishers, jobs
├── logging/
├── testing/
└── reference/           # packages, best practices
src/css/custom.css       # theme overrides
static/img/              # logo & favicon
docusaurus.config.js     # site configuration
sidebars.js              # hand-curated sidebar / reading order
```

## Editing

- New page: add a markdown file under `docs/`, then add its id to `sidebars.js`.
- Each page needs front matter (`id`, `title`, `sidebar_label`) at the top.
- Link to other pages with relative `.md` paths so links are checked at build time.
