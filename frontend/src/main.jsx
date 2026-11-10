import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('HCM Lite render error:', error, info); }
  render() {
    if (this.state.error) return <main style={{maxWidth:760,margin:'8vh auto',padding:24,fontFamily:'system-ui',color:'#182230'}}>
      <h1>HCM Lite could not render this screen</h1>
      <p>The app caught a frontend error instead of showing a blank page. Take a screenshot of this message and share it for troubleshooting.</p>
      <pre style={{whiteSpace:'pre-wrap',padding:16,background:'#f2f4f7',borderRadius:8}}>{String(this.state.error?.message || this.state.error)}</pre>
      <button style={{padding:'10px 16px',cursor:'pointer'}} onClick={() => window.location.reload()}>Reload application</button>
    </main>;
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(<React.StrictMode><AppErrorBoundary><App /></AppErrorBoundary></React.StrictMode>);
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
