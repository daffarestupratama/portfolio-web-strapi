import type { Core } from '@strapi/strapi';

const routes: Core.RouterConfig = {
  type: 'content-api',
  routes: [
    {
      method: 'GET',
      path: '/s/:slug',
      handler: 'api::short-link.short-link.redirect',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};

export default routes;
