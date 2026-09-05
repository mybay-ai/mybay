import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { AppCore } from './App'
import { FeedbackProvider } from './components/FeedbackProvider'
import { ThemeProvider } from './components/ThemeProvider'
import './i18n'

export function render(url: string) {
  const helmetContext: any = {}
  const html = renderToString(
    <HelmetProvider context={helmetContext}>
      <MemoryRouter initialEntries={[url]}>
        <ThemeProvider>
          <FeedbackProvider>
            <AppCore />
          </FeedbackProvider>
        </ThemeProvider>
      </MemoryRouter>
    </HelmetProvider>
  )
  return { html, helmet: helmetContext.helmet }
}
