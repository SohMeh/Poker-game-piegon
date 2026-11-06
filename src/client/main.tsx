import { createRoot } from 'react-dom/client';
import { APP_NAME } from '../shared';

createRoot(document.getElementById('root')!).render(<h1>{APP_NAME}</h1>);
