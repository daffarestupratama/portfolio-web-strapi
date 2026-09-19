/**
 * certification controller
 */

import { factories } from '@strapi/strapi';

// `as any`: the generated content-type types don't yet include this new UID.
// Runtime behaviour is unaffected.
export default factories.createCoreController(
  'api::certification.certification' as any,
);
