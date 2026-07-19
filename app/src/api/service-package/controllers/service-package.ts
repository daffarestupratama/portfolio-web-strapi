/**
 * service-package controller
 */

import { factories } from '@strapi/strapi';

// `as any`: the generated content-type types don't yet include this new UID
// (they regenerate once Strapi runs in dev). Runtime behaviour is unaffected.
export default factories.createCoreController('api::service-package.service-package' as any);
