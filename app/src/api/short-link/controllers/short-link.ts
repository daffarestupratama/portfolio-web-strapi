import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::short-link.short-link', ({ strapi }) => ({
  async redirect(ctx: any) {
    const rawSlug = ctx.params.slug;
    const slug = String(rawSlug || '').trim().toLowerCase();

    if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(slug)) {
      ctx.status = 404;
      ctx.body = 'Short link not found';
      return;
    }

    const links = await strapi.db.query('api::short-link.short-link').findMany({
      where: {
        slug,
        isActive: true,
      },
      limit: 1,
    });

    const link = Array.isArray(links) ? links[0] : null;

    if (!link) {
      ctx.status = 404;
      ctx.body = 'Short link not found';
      return;
    }

    if (link.expiresAt && new Date(link.expiresAt).getTime() < Date.now()) {
      ctx.status = 410;
      ctx.body = 'Short link expired';
      return;
    }


    let destination: URL;

    try {
      let rawDestination = String(link.destinationUrl || '').trim();

      if (!rawDestination) {
        ctx.status = 500;
        ctx.body = 'Invalid destination URL';
        return;
      }

      // Allow users to input:
      // example.com
      // www.example.com
      // docs.google.com/forms/...
      // and normalize them to https://...
      if (!/^https?:\/\//i.test(rawDestination)) {
        rawDestination = `https://${rawDestination}`;
      }

      destination = new URL(rawDestination);
    } catch {
      ctx.status = 500;
      ctx.body = 'Invalid destination URL';
      return;
    }

    if (!['http:', 'https:'].includes(destination.protocol)) {
      ctx.status = 500;
      ctx.body = 'Invalid destination URL';
      return;
    }


    try {
      await strapi.db.query('api::short-link.short-link').update({
        where: { id: link.id },
        data: {
          clickCount: Number(link.clickCount || 0) + 1,
          lastClickedAt: new Date(),
        },
      });
    } catch (error) {
      strapi.log.warn(`[short-link] click tracking failed for slug="${slug}"`);
    }

    ctx.set('Cache-Control', 'no-store');
    ctx.redirect(destination.toString());
  },
}));
