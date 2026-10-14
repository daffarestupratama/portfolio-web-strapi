/**
 * guestbook-message controller
 *
 * Public reads only ever see `moderationStatus = visible`, whatever filters the client sends.
 * Requests authenticated with an API token (the site's server-side guestbook route) are untouched.
 */

import { factories } from '@strapi/strapi';

const UID = 'api::guestbook-message.guestbook-message';

const isApiToken = (ctx: any) => ctx.state?.auth?.strategy?.name === 'api-token';

export default factories.createCoreController(UID, ({ strapi }) => ({
  async find(ctx) {
    if (!isApiToken(ctx)) {
      // AND-ing the client's filters with ours means no client filter can widen the result.
      const clientFilters = ctx.query.filters ?? {};
      ctx.query = {
        ...ctx.query,
        filters: { $and: [clientFilters, { moderationStatus: { $eq: 'visible' } }] },
      } as any;
    }

    return super.find(ctx);
  },

  async findOne(ctx) {
    if (!isApiToken(ctx)) {
      const entry = await strapi.documents(UID).findOne({
        documentId: ctx.params.id,
        fields: ['moderationStatus'],
      });

      if (entry?.moderationStatus !== 'visible') {
        return ctx.notFound();
      }
    }

    return super.findOne(ctx);
  },
}));
