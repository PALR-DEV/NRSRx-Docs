// @ts-check
// Docusaurus configuration for the NRSRx documentation site.
// See https://docusaurus.io/docs/api/docusaurus-config for all options.

import { themes as prismThemes } from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'NRSRx',
  tagline: 'An opinionated, extensible framework for building .NET back-end microservices',
  favicon: 'img/favicon.svg',

  url: 'https://palr-dev.github.io',
  baseUrl: '/NRSRx-Docs/',

  organizationName: 'PALR-DEV',
  projectName: 'NRSRx-Docs',

  onBrokenLinks: 'warn',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          path: 'docs',
          routeBasePath: '/', // serve the docs at the site root
          sidebarPath: './sidebars.js',
          editUrl: 'https://github.com/ikemtz/NRSRx/tree/master/website/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/social-card.png',
      colorMode: {
        defaultMode: 'dark',
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: 'NRSRx',
        logo: {
          alt: 'NRSRx Logo',
          src: 'img/logo.svg',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'docsSidebar',
            position: 'left',
            label: 'Documentation',
          },
          {
            href: 'https://www.nuget.org/packages?q=nrsrx',
            label: 'NuGet',
            position: 'right',
          },
          {
            href: 'https://github.com/ikemtz/NRSRx',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Docs',
            items: [
              { label: 'Introduction', to: '/' },
              { label: 'Getting Started', to: '/getting-started' },
              { label: 'Packages', to: '/reference/packages' },
            ],
          },
          {
            title: 'Community',
            items: [
              { label: 'GitHub', href: 'https://github.com/ikemtz/NRSRx' },
              { label: 'NuGet', href: 'https://www.nuget.org/packages?q=nrsrx' },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} NRSRx. Documentation by Pedro Lorenzo Rosario. Built with Docusaurus.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
        additionalLanguages: ['csharp', 'sql', 'bash', 'json', 'powershell'],
      },
    }),
};

export default config;
