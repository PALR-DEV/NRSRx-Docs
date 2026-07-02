// @ts-check

/**
 * The sidebar for the NRSRx documentation.
 * Curated by hand so that the reading order tells a coherent story:
 * what NRSRx is → how to start → core concepts → service flavors →
 * data → eventing & jobs → logging → testing → reference.
 *
 * @type {import('@docusaurus/plugin-content-docs').SidebarsConfig}
 */
const sidebars = {
  docsSidebar: [
    'intro',
    'getting-started',
    {
      type: 'category',
      label: 'Core Concepts',
      collapsed: false,
      items: [
        'concepts/architecture',
        'concepts/cross-cutting-concerns',
        'concepts/configuration',
        'concepts/authentication-authorization',
        'concepts/multi-tenancy',
        'concepts/versioning',
        'concepts/swagger',
      ],
    },
    {
      type: 'category',
      label: 'Service Flavors',
      collapsed: false,
      items: [
        'flavors/overview',
        'flavors/webapi',
        'flavors/odata',
        'flavors/signalr',
      ],
    },
    {
      type: 'category',
      label: 'Data & Models',
      items: [
        'data/models-and-interfaces',
        'data/entity-framework',
        'data/simple-mapper',
        'data/collection-sync',
      ],
    },
    {
      type: 'category',
      label: 'Eventing & Jobs',
      items: [
        'eventing/overview',
        'eventing/publishers',
        'eventing/jobs',
        'eventing/cron-jobs',
      ],
    },
    'logging/overview',
    {
      type: 'category',
      label: 'Testing',
      items: [
        'testing/unigration',
        'testing/test-helpers-reference',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        'reference/packages',
        'reference/best-practices',
        'reference/authorization-filters',
        'reference/jwt-helpers',
      ],
    },
  ],
};

export default sidebars;
