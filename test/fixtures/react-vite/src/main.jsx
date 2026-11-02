import { createRoot } from 'react-dom/client';
import { Card } from './Card';
import './base.css';

const theme = window.theme ?? {};
createRoot(document.getElementById('root')).render(<>
  <p style={{ fontFamily: '"Atlas Sans", sans-serif', fontWeight: 600 }}>Inline</p>
  <p style={{ fontFamily: theme.font }}>Dynamic</p>
  <Card />
</>);
