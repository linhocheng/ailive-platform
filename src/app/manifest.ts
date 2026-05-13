import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AILIVE',
    short_name: 'AILIVE',
    description: '與角色共生的對話與創作平台',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#F5F4F1',
    theme_color: '#1A1916',
    orientation: 'portrait',
    lang: 'zh-Hant',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
