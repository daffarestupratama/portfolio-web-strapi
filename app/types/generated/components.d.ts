import type { Schema, Struct } from '@strapi/strapi';

export interface SharedContactLink extends Struct.ComponentSchema {
  collectionName: 'components_shared_contact_links';
  info: {
    displayName: 'contact-link';
    icon: 'phone';
  };
  attributes: {
    icon: Schema.Attribute.String;
    isPrimary: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    label: Schema.Attribute.String;
    linkType: Schema.Attribute.Enumeration<
      [
        'email',
        'whatsapp',
        'instagram',
        'linkedin',
        'github',
        'kaggle',
        'tableau',
        'x',
        'website',
        'booking',
        'tiktok',
        'other',
      ]
    >;
    sortOrder: Schema.Attribute.Integer;
    url: Schema.Attribute.String;
  };
}

export interface SharedCta extends Struct.ComponentSchema {
  collectionName: 'components_shared_ctas';
  info: {
    displayName: 'cta';
    icon: 'cursor';
  };
  attributes: {
    description: Schema.Attribute.Text;
    label: Schema.Attribute.String;
    style: Schema.Attribute.Enumeration<['primary', 'secondary', 'ghost']>;
    url: Schema.Attribute.String;
  };
}

export interface SharedGalleryImage extends Struct.ComponentSchema {
  collectionName: 'components_shared_gallery_images';
  info: {
    displayName: 'gallery-image';
    icon: 'landscape';
  };
  attributes: {
    alt: Schema.Attribute.String;
    caption: Schema.Attribute.Text;
    image: Schema.Attribute.Media<'images' | 'files' | 'videos' | 'audios'>;
    order: Schema.Attribute.Integer;
  };
}

export interface SharedNotebookResource extends Struct.ComponentSchema {
  collectionName: 'components_shared_notebook_resources';
  info: {
    displayName: 'notebook-resource';
    icon: 'book';
  };
  attributes: {
    description: Schema.Attribute.Text;
    embedUrl: Schema.Attribute.Text;
    file: Schema.Attribute.Media<'images' | 'files' | 'videos' | 'audios'>;
    kind: Schema.Attribute.Enumeration<
      [
        'jupyter_notebook',
        'r_notebook',
        'html_export',
        'interactive_chart',
        'static_chart',
        'dashboard',
        'dataset',
        'github',
        'live_demo',
        'other',
      ]
    >;
    order: Schema.Attribute.Integer;
    title: Schema.Attribute.String;
    url: Schema.Attribute.String;
  };
}

export interface SharedPriceOption extends Struct.ComponentSchema {
  collectionName: 'components_shared_price_options';
  info: {
    displayName: 'price-option';
    icon: 'store';
  };
  attributes: {
    currency: Schema.Attribute.Enumeration<['IDR', 'USD', 'EUR']>;
    description: Schema.Attribute.Text;
    price: Schema.Attribute.Decimal;
    title: Schema.Attribute.String;
  };
}

export interface SharedRouteStop extends Struct.ComponentSchema {
  collectionName: 'components_shared_route_stops';
  info: {
    displayName: 'route-stop';
    icon: 'pinMap';
  };
  attributes: {
    description: Schema.Attribute.Text;
    image: Schema.Attribute.Media<'images' | 'files' | 'videos' | 'audios'>;
    locationText: Schema.Attribute.String;
    mapUrl: Schema.Attribute.String;
    order: Schema.Attribute.Integer;
    title: Schema.Attribute.String;
  };
}

export interface SharedSeo extends Struct.ComponentSchema {
  collectionName: 'components_shared_seos';
  info: {
    displayName: 'seo';
    icon: 'search';
  };
  attributes: {
    canonicalUrl: Schema.Attribute.String;
    metaDescription: Schema.Attribute.Text;
    metaTitle: Schema.Attribute.String;
    noIndex: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    ogImage: Schema.Attribute.Media<'images' | 'files' | 'videos' | 'audios'>;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'shared.contact-link': SharedContactLink;
      'shared.cta': SharedCta;
      'shared.gallery-image': SharedGalleryImage;
      'shared.notebook-resource': SharedNotebookResource;
      'shared.price-option': SharedPriceOption;
      'shared.route-stop': SharedRouteStop;
      'shared.seo': SharedSeo;
    }
  }
}
