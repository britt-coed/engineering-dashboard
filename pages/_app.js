import '../styles/globals.css';

// Grid.js theme — must be imported here as a global stylesheet
// (Next.js only allows CSS imports in _app.js)
import 'gridjs/dist/theme/mermaid.min.css';

export default function App({ Component, pageProps }) {
  return <Component {...pageProps} />;
}
