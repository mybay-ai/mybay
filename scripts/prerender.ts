import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { structuredDocsRegistry, VALID_GUIDES } from '../src/data/docs/docs.registry.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const toAbsolute = (p: string) => path.resolve(__dirname, '..', p)
const publicAppUrl = process.env.PUBLIC_APP_URL || process.env.VITE_PUBLIC_APP_URL || 'http://localhost:3000'
process.env.VITE_PUBLIC_APP_URL = publicAppUrl
process.env.DISABLE_HMR = 'true'

const fixedPublicRoutes = [
  '/',
  '/docs',
  '/faq',
  '/changelog',
  '/privacy',
  '/terms',
  '/security',
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

  // 3. Check that the legacy VALID_GUIDES export remains aligned with the
  // structured registry consumed by the current documentation UI.
  const dupValidGuides = VALID_GUIDES.filter((id, i) => VALID_GUIDES.indexOf(id) !== i)
  if (dupValidGuides.length > 0) {
    throw new Error(`[Validation Error] Duplicate IDs found in VALID_GUIDES: ${Array.from(new Set(dupValidGuides)).join(', ')}`)
  }

  const validSet = new Set(VALID_GUIDES)
  const registrySet = new Set(regIds)
  const missingInRegistry = VALID_GUIDES.filter(id => !registrySet.has(id))
  const missingInValidGuides = regIds.filter(id => !validSet.has(id))
  if (missingInRegistry.length > 0 || missingInValidGuides.length > 0) {
    throw new Error(
      `[Validation Error] Documentation IDs are out of sync. Missing in structuredDocsRegistry: ${missingInRegistry.join(', ') || 'none'}; missing in VALID_GUIDES: ${missingInValidGuides.join(', ') || 'none'}.`
    )
  }

  console.log('✓ Validation successful: structuredDocsRegistry and VALID_GUIDES are in sync!')
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
    if (!appHtml.includes('data-page="security"')) {
      const renderError = appHtml.match(/<template data-msg="([\s\S]*?)" data-stck=/)?.[1]
      throw new Error(`[Validation Error] Prerendered HTML for "/security" is missing the stable page marker: data-page="security".${renderError ? ` SSR error: ${renderError}` : ''}`);
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
      const indexPath = toAbsolute('dist/index.html')
      const spaPath = toAbsolute('dist/spa.html')
      const indexTemplate = fs.readFileSync(indexPath, 'utf-8')
      const savedSpaTemplate = fs.existsSync(spaPath) ? fs.readFileSync(spaPath, 'utf-8') : ''
      const template = indexTemplate.includes('<!--ssr-outlet-->') ? indexTemplate : savedSpaTemplate
      if (!template.includes('<!--ssr-outlet-->')) {
        throw new Error('The Vite SPA template is missing <!--ssr-outlet-->. Run npm run build before prerendering.')
      }
      // Preserve the clean SPA template for non-prerendered routes and repeat runs.
      if (template === indexTemplate) fs.writeFileSync(spaPath, template)
      
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

      // Generate sitemap.xml directly in the build output without mutating source files.
      const sitemapContent = generateSitemapXml(routesToPrerender)
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
