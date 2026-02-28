/// <reference types="vite/client" />
/// <reference types="w3c-web-serial" />

interface CanFrame {
  timestamp: string;
  type: 'TX' | 'RX';
  id: string;
  dlc: number;
  data: string;
}
