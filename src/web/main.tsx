import { createRoot } from 'react-dom/client';
import { App } from './App';
import { CustomerDisplay } from './customer';
import './styles.css';

const customer = window.location.pathname.replace(/\/+$/, '') === '/customer';
createRoot(document.getElementById('root')!).render(customer ? <CustomerDisplay /> : <App />);
