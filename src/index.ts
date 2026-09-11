import 'dotenv/config';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 8080);
createApp().listen(port, () => {
  console.log(`bm-hr listening on :${port}`);
});
