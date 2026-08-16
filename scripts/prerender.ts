import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { structuredDocsRegistry, VALID_GUIDES } from '../src/data/docs/docs.registry.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const toAbsolute = (p: string) => path.resolve(__dirname, '..', p)
const publicAppUrl = process.env.PUBLIC_APP_URL || process.env.VITE_PUBLIC_APP_URL || 'http://localhost:3000'
process.env.DISABLE_HMR = 'true'

const fixedPublicRoutes = [
  '/',
  '/features',
  '/models',
  '/docs',
  '/faq',
  '/changelog',
  '/privacy',
  '/terms',
  '/security',
  '/contact',
]

const structuredDocRoutes = structuredDocsRegistry.map(
  doc => `/docs/${doc.slug}`
)

const routesToPrerender = Array.from(
  new Set([...fixedPublicRoutes, ...structuredDocRoutes])
)

interface PublicRouteConfig {
  path: string;
  changefreq: string;
  priority: string;
  lastmod?: string;
}

const getSitemapConfig = (url: string): PublicRouteConfig => {
  let priority = '0.8'
  let changefreq = 'weekly'
  let lastmod: string | undefined = undefined
  
  if (url === '/') {
    priority = '1.0'
    changefreq = 'daily'
  } else if (url.startsWith('/docs/')) {
    priority = '0.9'
    changefreq = 'weekly'
    const slug = url.replace('/docs/', '')
    const doc = structuredDocsRegistry.find(d => d.slug === slug)
    if (doc && doc.updatedAt) {
      lastmod = doc.updatedAt
    }
  } else if (url === '/privacy' || url === '/terms' || url === '/security') {
    priority = '0.3'
    changefreq = 'monthly'
  } else if (url === '/faq' || url === '/changelog') {
    priority = '0.7'
    changefreq = 'weekly'
  } else if (url === '/contact') {
    priority = '0.6'
    changefreq = 'monthly'
  }
  
  return { path: url, changefreq, priority, lastmod }
}

function generateSitemapXml(urls: string[]): string {
  const domain = publicAppUrl
  
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`
  xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
  
  for (const url of urls) {
    const config = getSitemapConfig(url)
    const loc = `${domain}${url === '/' ? '' : url}`
    
    xml += `  <url>\n`
    xml += `    <loc>${loc}</loc>\n`
    if (config.lastmod) {
      xml += `    <lastmod>${config.lastmod}</lastmod>\n`
    }
    xml += `    <changefreq>${config.changefreq}</changefreq>\n`
    xml += `    <priority>${config.priority}</priority>\n`
    xml += `  </url>\n`
  }
  
  xml += `</urlset>`
  return xml
}

function verifyNavigationConsistency() {
  console.log('Running robust validation checks for registry and navigation...')

  // 1. Validate structuredDocsRegistry items
  const regIds: string[] = []
  const regSlugs: string[] = []
  const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/

  structuredDocsRegistry.forEach((doc: any, index: number) => {
    if (!doc.id || typeof doc.id !== 'string' || doc.id.trim() === '') {
      throw new Error(`[Validation Error] Document at index ${index} has empty or missing ID.`)
    }
    if (!doc.slug || typeof doc.slug !== 'string' || doc.slug.trim() === '') {
      throw new Error(`[Validation Error] Document with ID "${doc.id}" has empty or missing slug.`)
    }
    if (!slugRegex.test(doc.slug)) {
      throw new Error(`[Validation Error] Document with ID "${doc.id}" has invalid slug format: "${doc.slug}". Slugs must only contain lowercase alphanumeric characters and hyphens (pattern: ^[a-z0-9]+(?:-[a-z0-9]+)*$).`)
    }
    if (!doc.updatedAt || typeof doc.updatedAt !== 'string' || !dateRegex.test(doc.updatedAt)) {
      throw new Error(`[Validation Error] Document with ID "${doc.id}" has invalid or missing updatedAt date format: "${doc.updatedAt}". Must follow YYYY-MM-DD.`)
    }

    regIds.push(doc.id)
    regSlugs.push(doc.slug)
  })

  // 2. Check duplicates inside structuredDocsRegistry
  const dupRegIds = regIds.filter((id, i) => regIds.indexOf(id) !== i)
  if (dupRegIds.length > 0) {
    throw new Error(`[Validation Error] Duplicate IDs found in structuredDocsRegistry: ${Array.from(new Set(dupRegIds)).join(', ')}`)
  }

  const dupRegSlugs = regSlugs.filter((slug, i) => regSlugs.indexOf(slug) !== i)
  if (dupRegSlugs.length > 0) {
    throw new Error(`[Validation Error] Duplicate slugs found in structuredDocsRegistry: ${Array.from(new Set(dupRegSlugs)).join(', ')}`)
  }

  // 3. Check duplicates inside VALID_GUIDES
  const dupValidGuides = VALID_GUIDES.filter((id, i) => VALID_GUIDES.indexOf(id) !== i)
  if (dupValidGuides.length > 0) {
    throw new Error(`[Validation Error] Duplicate IDs found in VALID_GUIDES: ${Array.from(new Set(dupValidGuides)).join(', ')}`)
  }

  // 4. Load translation navigation configurations
  const zhPath = toAbsolute('src/locales/zh-CN/marketing.json')
  const enPath = toAbsolute('src/locales/en/marketing.json')
  
  const zhContent = JSON.parse(fs.readFileSync(zhPath, 'utf-8'))
  const enContent = JSON.parse(fs.readFileSync(enPath, 'utf-8'))
  
  const zhNav = zhContent.docs?.nav || zhContent["docs.nav"] || zhContent.nav
  const enNav = enContent.docs?.nav || enContent["docs.nav"] || enContent.nav

  if (!zhNav || !Array.isArray(zhNav)) {
    throw new Error('Failed to parse "nav" from zh-CN marketing.json')
  }
  if (!enNav || !Array.isArray(enNav)) {
    throw new Error('Failed to parse "nav" from en marketing.json')
  }

  const zhIds: string[] = []
  zhNav.forEach((group: any) => {
    if (group.items && Array.isArray(group.items)) {
      group.items.forEach((item: any) => {
        if (item.id) zhIds.push(item.id)
      })
    }
  })

  const enIds: string[] = []
  enNav.forEach((group: any) => {
    if (group.items && Array.isArray(group.items)) {
      group.items.forEach((item: any) => {
        if (item.id) enIds.push(item.id)
      })
    }
  })

  // 5. Check duplicates in zh-CN and en translations
  const dupZhIds = zhIds.filter((id, i) => zhIds.indexOf(id) !== i)
  if (dupZhIds.length > 0) {
    throw new Error(`[Validation Error] Duplicate IDs found in zh-CN marketing.json nav: ${Array.from(new Set(dupZhIds)).join(', ')}`)
  }

  const dupEnIds = enIds.filter((id, i) => enIds.indexOf(id) !== i)
  if (dupEnIds.length > 0) {
    throw new Error(`[Validation Error] Duplicate IDs found in en marketing.json nav: ${Array.from(new Set(dupEnIds)).join(', ')}`)
  }

  // 6. Compare sets to verify consistency
  const validSet = new Set(VALID_GUIDES)
  const zhSet = new Set(zhIds)
  const enSet = new Set(enIds)

  // Verify zh-CN vs VALID_GUIDES
  const missingInZh = VALID_GUIDES.filter(id => !zhSet.has(id))
  const extraInZh = zhIds.filter(id => !validSet.has(id))

  // Verify en vs VALID_GUIDES
  const missingInEn = VALID_GUIDES.filter(id => !enSet.has(id))
  const extraInEn = enIds.filter(id => !validSet.has(id))

  let hasError = false
  if (missingInZh.length > 0) {
    console.error(`[Verification Error] VALID_GUIDES has items missing in zh-CN marketing.json: ${missingInZh.join(', ')}`)
    hasError = true
  }
  if (extraInZh.length > 0) {
    console.error(`[Verification Error] zh-CN marketing.json has items missing in VALID_GUIDES: ${extraInZh.join(', ')}`)
    hasError = true
  }
  if (missingInEn.length > 0) {
    console.error(`[Verification Error] VALID_GUIDES has items missing in en marketing.json: ${missingInEn.join(', ')}`)
    hasError = true
  }
  if (extraInEn.length > 0) {
    console.error(`[Verification Error] en marketing.json has items missing in VALID_GUIDES: ${extraInEn.join(', ')}`)
    hasError = true
  }

  if (hasError) {
    throw new Error('Documentation IDs are out of sync! Please verify VALID_GUIDES in src/data/docs/docs.registry.ts, and the "nav" arrays in zh-CN and en marketing.json.')
  }

  console.log('✓ Validation successful: Registry items, zh-CN nav, en nav, and VALID_GUIDES are perfectly correct and in sync!')
}

function validatePrerenderedPage(url: string, html: string, appHtml: string) {
  // Check if length is too short
  if (html.length < 1000) {
    throw new Error(`[Validation Error] Prerendered HTML for "${url}" is abnormally short (${html.length} bytes). This usually indicates a broken or fallback render.`);
  }

  // 404 page is allowed to contain 404/noindex markers, but other pages are not
  const is404Route = url === '/404';

  if (!is404Route) {
    // Check for 404 markers
    if (html.includes('页面未找到') || html.includes('Page Not Found')) {
      throw new Error(`[Validation Error] Prerendered HTML for "${url}" contains 404 markers ("页面未找到" or "Page Not Found").`);
    }

    // Check for noindex
    if (html.includes('noindex') || html.includes('nofollow')) {
      throw new Error(`[Validation Error] Prerendered HTML for "${url}" contains SEO-blocking "noindex" or "nofollow" meta tags.`);
    }
  }

  // Specific check for /security
  if (url === '/security') {
    if (!html.includes('data-page="security"')) {
      throw new Error(`[Validation Error] Prerendered HTML for "/security" is missing the stable page marker: data-page="security".`);
    }
    const expectedCanonical = `${publicAppUrl}/security`;
    if (!html.includes('rel="canonical"') || !html.includes(expectedCanonical)) {
      throw new Error(`[Validation Error] Prerendered HTML for "/security" is missing correct canonical link: ${expectedCanonical}.`);
    }
  }
}

;(async () => {
  // Run navigation IDs consistency test
  try {
    verifyNavigationConsistency();
  } catch (err: any) {
    console.error('\n❌ BUILD RUNTIME ERROR: Navigation verification failed!');
    console.error(err.message || err);
    process.exit(1);
  }

  try {
    const vite = await createServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'custom'
    })

    try {
      const template = fs.readFileSync(toAbsolute('dist/index.html'), 'utf-8')
      // Save a copy of the clean SPA template for non-prerendered routes
      fs.writeFileSync(toAbsolute('dist/spa.html'), template)
      
      const { render } = await vite.ssrLoadModule('/src/entry-server.tsx')

      console.log('Starting page pre-rendering and build-time validation...');
      for (const url of routesToPrerender) {
        const { html: appHtml, helmet } = await render(url)

        // Inject pre-rendered content and marker
        const html = template
          .replace(`<div id="root"><!--ssr-outlet--></div>`, `<div id="root" data-prerendered="true"><!--ssr-outlet--></div>`)
          .replace(`<!--ssr-outlet-->`, appHtml)
          .replace(`<!--title-outlet-->`, helmet?.title?.toString() || "")
          .replace(
            `<!--meta-outlet-->`,
            [
              helmet?.meta?.toString(),
              helmet?.link?.toString(),
              helmet?.script?.toString(),
              helmet?.noscript?.toString(),
              helmet?.style?.toString(),
            ].filter(Boolean).join('\n')
          )

        // Perform validation before writing to disk
        validatePrerenderedPage(url, html, appHtml)

        const filePath = url === '/' ? 'dist/index.html' : `dist${url}/index.html`
        const dirPath = path.dirname(toAbsolute(filePath))
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true })
        }
        fs.writeFileSync(toAbsolute(filePath), html)
        console.log('✓ Validated and pre-rendered:', url)
      }

      // Pre-render 404 page
      console.log('pre-rendering 404.html...')
      const { html: app404Html, helmet: helmet404 } = await render('/404')
      const html404 = template
        .replace(`<div id="root"><!--ssr-outlet--></div>`, `<div id="root" data-prerendered="true"><!--ssr-outlet--></div>`)
        .replace(`<!--ssr-outlet-->`, app404Html)
        .replace(`<!--title-outlet-->`, helmet404?.title?.toString() || "")
        .replace(
          `<!--meta-outlet-->`,
          [
            helmet404?.meta?.toString(),
            helmet404?.link?.toString(),
            helmet404?.script?.toString(),
            helmet404?.noscript?.toString(),
            helmet404?.style?.toString(),
          ].filter(Boolean).join('\n')
        )
      
      // Perform validation for 404 page
      validatePrerenderedPage('/404', html404, app404Html)
      
      fs.writeFileSync(toAbsolute('dist/404.html'), html404)
      console.log('✓ Prerendered and validated 404.html successfully!')

      // Generate sitemap.xml and write to public/ and dist/
      const sitemapContent = generateSitemapXml(routesToPrerender)
      fs.writeFileSync(toAbsolute('public/sitemap.xml'), sitemapContent)
      fs.writeFileSync(toAbsolute('dist/sitemap.xml'), sitemapContent)
      console.log('sitemap.xml generated successfully!')

      // Validate dist/.well-known/security.txt
      console.log('Validating dist/.well-known/security.txt...')
      const distSecurityTxtPath = toAbsolute('dist/.well-known/security.txt')
      if (!fs.existsSync(distSecurityTxtPath)) {
        throw new Error('[Validation Error] dist/.well-known/security.txt does not exist in the build folder!');
      }
      const secContent = fs.readFileSync(distSecurityTxtPath, 'utf-8')
      if (secContent.length < 50) {
        throw new Error(`[Validation Error] dist/.well-known/security.txt is abnormally small (${secContent.length} bytes).`);
      }
      if (!secContent.includes('Contact:')) {
        throw new Error('[Validation Error] dist/.well-known/security.txt is missing "Contact:" field.');
      }
      if (!secContent.includes('Expires:')) {
        throw new Error('[Validation Error] dist/.well-known/security.txt is missing "Expires:" field.');
      }
      console.log('✓ dist/.well-known/security.txt validated successfully!')

    } finally {
      await vite.close()
    }
  } catch (err: any) {
    console.error('\n❌ BUILD RUNTIME ERROR: Build-time pre-rendering or validation failed!');
    console.error(err.message || err);
    process.exit(1);
  }
})()
