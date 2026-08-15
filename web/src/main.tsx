import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import App from '@/App';
import { createQueryClient } from '@/lib/queries';
import '@/styles/theme.css';
import '@/styles/app.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('missing #root element');
}

// One client for the life of the page; a new one per render would throw the
// whole cache away on every state change.
const queryClient = createQueryClient();

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
