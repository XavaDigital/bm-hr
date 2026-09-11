// Google Identity Services (GIS) button API, loaded from accounts.google.com/gsi/client.
interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleAccountsId {
  initialize(config: { client_id: string; callback: (r: GoogleCredentialResponse) => void; ux_mode?: 'popup' }): void;
  renderButton(
    parent: HTMLElement,
    options: { theme?: 'outline' | 'filled_black'; size?: 'large'; width?: number; text?: 'signin_with' },
  ): void;
}

interface Window {
  google?: { accounts: { id: GoogleAccountsId } };
}
