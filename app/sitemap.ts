import type { MetadataRoute } from 'next';

const base = 'https://samuellucas.com.br';

export default function sitemap(): MetadataRoute.Sitemap {
  return ['/', '/artigos/ia-reduzir-desperdicios-clinicas-oncologicas'].map((route) => ({
    url: `${base}${route}`,
    lastModified: new Date(),
    changeFrequency: 'weekly',
    priority: route === '/' ? 1 : 0.9
  }));
}
