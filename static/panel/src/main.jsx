import React from 'react';
import { createRoot } from 'react-dom/client';
import { view } from '@forge/bridge';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import './styles.css';
import App from './App.jsx';

// Follow the Jira theme (light/dark) before the first paint, so the panel never flashes the wrong colours.
view.theme.enable().finally(() => createRoot(document.getElementById('root')).render(<App />));
